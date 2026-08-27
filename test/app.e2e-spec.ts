import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { createConnection } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { REFRESH_COOKIE_NAME } from '../src/auth/refresh-cookie';

/** Pulls the raw Set-Cookie entry for a named cookie. */
function setCookieHeader(response: any, name: string): string | null {
  const raw: string[] = response.headers['set-cookie'] || [];
  return raw.find(entry => entry.indexOf(`${name}=`) === 0) || null;
}

/** Pulls just the value, for replaying a cookie by hand. */
function cookieValue(response: any, name: string): string | null {
  const header = setCookieHeader(response, name);
  if (!header) return null;
  const value = header.split(';')[0].split('=')[1];
  return value || null;
}

const asCookie = (value: string): string => `${REFRESH_COOKIE_NAME}=${value}`;

/**
 * End-to-end coverage of the flows that carry the most risk: authentication,
 * authorisation on formerly public endpoints, refresh-token rotation, the
 * rate limiter, and loan copy accounting.
 *
 * Requires a reachable MySQL. The suite owns its own schema (library_e2e_db by
 * default) and drops it on every run, so it never touches development data.
 */

const stamp = Date.now();

const admin = {
  name: 'E2E Super Admin',
  email: `e2e-admin-${stamp}@test.local`,
  phone: '0000000000',
  password: 'AdminPass123',
  securityQuestion: 'What city were you born in?',
  securityAnswer: 'Paris',
};

const borrower = {
  name: 'E2E Borrower',
  email: `e2e-borrower-${stamp}@test.local`,
  phone: '1111111111',
  password: 'BorrowPass123',
  securityQuestion: 'What is your favorite movie?',
  securityAnswer: 'Alien',
};

const SECRET_FIELDS = ['password', 'securityAnswer', 'securityQuestion'];

function hasSecrets(body: any): boolean {
  if (!body || typeof body !== 'object') return false;
  return SECRET_FIELDS.some(field => Object.prototype.hasOwnProperty.call(body, field));
}

async function resetSchema(): Promise<void> {
  const connection = await createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
  });
  const name = process.env.DB_NAME;
  await connection.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await connection.query(`CREATE DATABASE \`${name}\``);
  await connection.end();
}

describe('Library API (e2e)', () => {
  let app: INestApplication;
  let http: any;

  let adminToken: string;
  let adminRefresh: string;
  let adminId: string;
  let loginResponse: any;
  let borrowerToken: string;
  let borrowerId: string;
  let bookId: string;

  beforeAll(async () => {
    await resetSchema();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirrors the pipe configured in main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('first-run setup', () => {
    it('reports that setup is needed', async () => {
      const res = await request(http).get('/auth/check-setup').expect(200);
      expect(res.body.needsSetup).toBe(true);
    });

    it('creates the super admin without echoing secrets', async () => {
      const res = await request(http).post('/auth/setup-super-admin').send(admin).expect(201);
      expect(hasSecrets(res.body)).toBe(false);
      expect(res.body.email).toBe(admin.email);
    });

    it('refuses a second setup', async () => {
      await request(http).post('/auth/setup-super-admin').send(admin).expect(400);
    });

    it('signs in, returning the access token in the body', async () => {
      const res = await request(http)
        .post('/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);

      expect(typeof res.body.access_token).toBe('string');
      expect(hasSecrets(res.body.user)).toBe(false);

      loginResponse = res;
      adminToken = res.body.access_token;
      adminRefresh = cookieValue(res, REFRESH_COOKIE_NAME);
      adminId = res.body.user.id;
    });

    it('never puts the refresh token in the response body', () => {
      // If page script can read it, moving it to a cookie bought nothing.
      expect(loginResponse.body.refresh_token).toBeUndefined();
      expect(JSON.stringify(loginResponse.body)).not.toContain(adminRefresh);
    });

    it('delivers the refresh token as a hardened cookie', () => {
      const header = setCookieHeader(loginResponse, REFRESH_COOKIE_NAME);

      expect(header).toBeTruthy();
      // httpOnly is what puts it out of reach of injected script.
      expect(header).toMatch(/HttpOnly/i);
      // SameSite=Strict is what stops another origin from driving /auth/refresh.
      expect(header).toMatch(/SameSite=Strict/i);
      // Scoped so it is not attached to ordinary API calls.
      expect(header).toMatch(/Path=\/auth/i);
    });

    it('seeds the super admin group with every role', async () => {
      const res = await request(http)
        .get('/auth/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(hasSecrets(res.body)).toBe(false);

      const roleNames = (res.body.groups[0].roles || []).map((r: any) => r.name);
      // Regression: these lookups used to run before the roles existed, leaving
      // the super admin with no permissions at all.
      expect(roleNames).toContain('role:read');
      expect(roleNames).toContain('user:create');
      expect(roleNames).toContain('book:create');
      expect(roleNames).toContain('book:approve');
      expect(roleNames).toContain('book_lending:approve');
    });
  });

  describe('authorisation', () => {
    it('rejects anonymous access to the dashboard', () => request(http).get('/dashboard/stats').expect(401));

    it('rejects anonymous access to the catalogue', () => request(http).get('/books').expect(401));

    it('serves the dashboard to an authenticated caller without the loan table', async () => {
      const res = await request(http)
        .get('/dashboard/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.allLoans).toBeUndefined();
      expect(Array.isArray(res.body.recentLoans)).toBe(true);
      expect(Array.isArray(res.body.loansOverTime)).toBe(true);
    });
  });

  describe('query validation', () => {
    it('rejects an injected sort direction', () =>
      request(http)
        .get('/books')
        .query({ sortOrder: 'ASC, (SELECT 1)' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400));

    it('rejects an oversized page size', () =>
      request(http)
        .get('/books')
        .query({ limit: 100000 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400));

    it('accepts valid pagination', async () => {
      const res = await request(http)
        .get('/books')
        .query({ page: 1, limit: 5 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.totalPages).toBe('number');
    });
  });

  describe('refresh tokens', () => {
    it('exchanges the cookie for a new session and rotates it', async () => {
      const res = await request(http)
        .post('/auth/refresh')
        .set('Cookie', asCookie(adminRefresh))
        .expect(200);

      expect(typeof res.body.access_token).toBe('string');

      const rotated = cookieValue(res, REFRESH_COOKIE_NAME);
      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(adminRefresh);

      const previous = adminRefresh;
      adminToken = res.body.access_token;
      adminRefresh = rotated;

      // Rotation: the consumed token must not work a second time.
      await request(http).post('/auth/refresh').set('Cookie', asCookie(previous)).expect(401);
    });

    it('rejects a request with no cookie at all', () =>
      request(http).post('/auth/refresh').expect(401));

    it('rejects a made-up cookie value', () =>
      request(http).post('/auth/refresh').set('Cookie', asCookie('nonsense')).expect(401));

    it('clears the cookie when it rejects one', async () => {
      const res = await request(http)
        .post('/auth/refresh')
        .set('Cookie', asCookie('nonsense'))
        .expect(401);

      // Otherwise the browser keeps resending a token that can only ever fail.
      expect(setCookieHeader(res, REFRESH_COOKIE_NAME)).toBeTruthy();
    });

    it('treats an immediate replay as a race and spares the rotated session', async () => {
      const login = await request(http)
        .post('/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);

      const first = cookieValue(login, REFRESH_COOKIE_NAME);
      const rotated = await request(http)
        .post('/auth/refresh')
        .set('Cookie', asCookie(first))
        .expect(200);
      const second = cookieValue(rotated, REFRESH_COOKIE_NAME);

      // Two tabs restoring at once both send `first`. The loser is refused...
      await request(http).post('/auth/refresh').set('Cookie', asCookie(first)).expect(401);

      // ...but the session the winner received must keep working, otherwise an
      // ordinary double-load would sign the user out everywhere.
      await request(http).post('/auth/refresh').set('Cookie', asCookie(second)).expect(200);
    });

    it('revokes the whole family when a used token is replayed later', async () => {
      const login = await request(http)
        .post('/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);

      const first = cookieValue(login, REFRESH_COOKIE_NAME);
      const rotated = await request(http)
        .post('/auth/refresh')
        .set('Cookie', asCookie(first))
        .expect(200);
      const second = cookieValue(rotated, REFRESH_COOKIE_NAME);

      // Past the race window (1s in tests) a replay is a stolen credential.
      await new Promise(resolve => setTimeout(resolve, 1200));

      await request(http).post('/auth/refresh').set('Cookie', asCookie(first)).expect(401);
      // Theft response: the successor dies with it.
      await request(http).post('/auth/refresh').set('Cookie', asCookie(second)).expect(401);
    });

    it('revokes the token and clears the cookie on logout', async () => {
      const login = await request(http)
        .post('/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);
      const token = cookieValue(login, REFRESH_COOKIE_NAME);

      const out = await request(http).post('/auth/logout').set('Cookie', asCookie(token)).expect(200);
      expect(setCookieHeader(out, REFRESH_COOKIE_NAME)).toBeTruthy();

      await request(http).post('/auth/refresh').set('Cookie', asCookie(token)).expect(401);

      adminToken = login.body.access_token;
    });

    it('keeps the current device signed in after a password change', async () => {
      const login = await request(http)
        .post('/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);
      const otherDevice = cookieValue(login, REFRESH_COOKIE_NAME);

      const changed = await request(http)
        .patch('/auth/change-password')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .send({ currentPassword: admin.password, newPassword: admin.password })
        .expect(200);

      // This device is handed a replacement...
      const replacement = cookieValue(changed, REFRESH_COOKIE_NAME);
      expect(replacement).toBeTruthy();
      await request(http).post('/auth/refresh').set('Cookie', asCookie(replacement)).expect(200);

      // ...while every other session is revoked.
      await request(http).post('/auth/refresh').set('Cookie', asCookie(otherDevice)).expect(401);

      const relogin = await request(http)
        .post('/auth/login')
        .send({ email: admin.email, password: admin.password })
        .expect(200);
      adminToken = relogin.body.access_token;
    });
  });

  describe('security question lookup', () => {
    it('returns the question for a known address', async () => {
      const res = await request(http)
        .get('/auth/security-question')
        .query({ email: admin.email })
        .expect(200);

      expect(res.body.securityQuestion).toBe(admin.securityQuestion);
    });

    it('404s for an unknown address', () =>
      request(http)
        .get('/auth/security-question')
        .query({ email: 'nobody@test.local' })
        .expect(404));

    it('rejects a malformed address', () =>
      request(http).get('/auth/security-question').query({ email: 'not-an-email' }).expect(400));
  });

  describe('user administration', () => {
    it('creates an account and defaults it into the User group', async () => {
      const res = await request(http)
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Created By Admin',
          email: `e2e-created-${stamp}@test.local`,
          phone: '2222222222',
          password: 'CreatedPass123',
        })
        .expect(201);

      expect(hasSecrets(res.body)).toBe(false);
      expect(res.body.groups.map((g: any) => g.name)).toContain('User');
    });

    it('rejects a duplicate email with a conflict', () =>
      request(http)
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Duplicate',
          email: `e2e-created-${stamp}@test.local`,
          phone: '3333333333',
          password: 'CreatedPass123',
        })
        .expect(409));

    it('rejects a too-short password', () =>
      request(http)
        .post('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Short',
          email: `e2e-short-${stamp}@test.local`,
          phone: '4444444444',
          password: 'short',
        })
        .expect(400));

    it('never exposes password hashes in the user list', async () => {
      const res = await request(http)
        .get('/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.every((user: any) => !hasSecrets(user))).toBe(true);
    });

    it('rejects a non-array roleIds payload', () =>
      request(http)
        .patch(`/users/${adminId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleIds: 'not-an-array' })
        .expect(400));

    it('refuses to delete the only super admin', () =>
      request(http).delete(`/users/${adminId}`).set('Authorization', `Bearer ${adminToken}`).expect(400));

    it('refuses to block the only super admin', () =>
      request(http)
        .patch(`/users/${adminId}/block`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ blocked: true })
        .expect(400));

    it('refuses to strip the super admin group from its only member', () =>
      request(http)
        .patch(`/users/${adminId}/groups`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ groupIds: [] })
        .expect(400));
  });

  describe('lending lifecycle', () => {
    it('registers a borrower into the default group', async () => {
      await request(http).post('/auth/register').send(borrower).expect(201);

      const login = await request(http)
        .post('/auth/login')
        .send({ email: borrower.email, password: borrower.password })
        .expect(200);

      borrowerToken = login.body.access_token;
      borrowerId = login.body.user.id;

      // The default group is what makes a freshly registered account able to
      // borrow at all.
      expect(login.body.user.groups.map((g: any) => g.name)).toContain('User');
    });

    it('creates an auto-approved book', async () => {
      const res = await request(http)
        .post('/books')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: `E2E Book ${stamp}`,
          author: 'Tester',
          isbn: `E2E-${stamp}`,
          category: 'Testing',
          totalCopies: 2,
          isEbook: false,
        })
        .expect(201);

      expect(res.body.status).toBe('approved');
      expect(res.body.availableCopies).toBe(2);
      bookId = res.body.id;
    });

    it('rejects a duplicate ISBN with a conflict', () =>
      request(http)
        .post('/books')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Duplicate',
          author: 'Tester',
          isbn: `E2E-${stamp}`,
          category: 'Testing',
          totalCopies: 1,
          isEbook: false,
        })
        .expect(409));

    const availableCopies = async (): Promise<number> => {
      const res = await request(http)
        .get(`/books/${bookId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      return res.body.availableCopies;
    };

    let loanId: string;

    it('creates a pending request that reserves nothing', async () => {
      const res = await request(http)
        .post('/loans/borrow')
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({ bookId })
        .expect(201);

      expect(res.body.status).toBe('pending');
      loanId = res.body.id;
      expect(await availableCopies()).toBe(2);
    });

    it('refuses a duplicate open request', () =>
      request(http)
        .post('/loans/borrow')
        .set('Authorization', `Bearer ${borrowerToken}`)
        .send({ bookId })
        .expect(400));

    it('decrements exactly once on approval', async () => {
      const res = await request(http)
        .patch(`/loans/${loanId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.status).toBe('active');
      expect(await availableCopies()).toBe(1);
    });

    it('refuses to approve the same loan twice', () =>
      request(http)
        .patch(`/loans/${loanId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400));

    it('restores the copy on return', async () => {
      const res = await request(http)
        .patch(`/loans/${loanId}/return`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.status).toBe('returned');
      expect(await availableCopies()).toBe(2);
    });

    it('issues a staff loan as active and takes one copy', async () => {
      const res = await request(http)
        .post('/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          bookId,
          userId: borrowerId,
          borrowDate: new Date().toISOString().split('T')[0],
          dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
        })
        .expect(201);

      expect(res.body.status).toBe('active');
      expect(await availableCopies()).toBe(1);

      await request(http)
        .delete(`/loans/${res.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(await availableCopies()).toBe(2);
    });

    it('rejects a due date before the borrow date', () =>
      request(http)
        .post('/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bookId, userId: borrowerId, borrowDate: '2026-05-01', dueDate: '2026-04-01' })
        .expect(400));

    it('stops a borrower from reaching the lending desk', () =>
      request(http).get('/loans').set('Authorization', `Bearer ${borrowerToken}`).expect(403));

    it('refuses to delete a book that has loan history', () =>
      request(http).delete(`/books/${bookId}`).set('Authorization', `Bearer ${adminToken}`).expect(400));

    it('refuses to delete a user who has loan history', () =>
      request(http).delete(`/users/${borrowerId}`).set('Authorization', `Bearer ${adminToken}`).expect(400));
  });

  // Last, because tripping the limiter blocks the route for the rest of the run.
  describe('rate limiting', () => {
    it('returns 429 once the reset-password window is exhausted', async () => {
      const attempt = () =>
        request(http)
          .post('/auth/reset-password')
          .send({ email: 'nobody@test.local', securityAnswer: 'x', newPassword: 'whatever123' });

      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await attempt();
        statuses.push(res.status);
      }

      // Limit is 5 per window: the first five are handled (404 for an unknown
      // address), the sixth is throttled.
      expect(statuses.slice(0, 5).every(status => status !== 429)).toBe(true);
      expect(statuses[5]).toBe(429);
    });
  });
});
