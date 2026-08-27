import { config as loadDotenv } from 'dotenv';
import { join } from 'path';

// Load .env before anything else reads process.env. This module is imported first
// by app.module.ts, so every entry point (main.ts, seed) picks the values up.
loadDotenv({ path: join(process.cwd(), '.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy backend/.env.example to backend/.env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function toInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${value}"`);
  }
  return parsed;
}

function toBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value === 'true' || value === '1';
}

function toList(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

export const env = {
  nodeEnv,
  isProduction,
  port: toInt('PORT', 5001),

  // No fallback on purpose: a hardcoded default secret means anyone can forge
  // an admin token against a default deployment.
  jwtSecret: required('JWT_SECRET'),
  // Short-lived, because it cannot be revoked before it expires. Sessions are
  // kept alive by the refresh token instead.
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '15m'),
  refreshTokenTtlDays: toInt('REFRESH_TOKEN_TTL_DAYS', 7),
  // Window in which re-presenting a just-consumed refresh token is treated as
  // a concurrency race instead of a stolen credential.
  refreshReuseGraceMs: toInt('REFRESH_REUSE_GRACE_MS', 30 * 1000),

  rateLimitEnabled: toBool('RATE_LIMIT_ENABLED', true),

  cookies: {
    // Must be true wherever the site is served over HTTPS.
    secure: toBool('COOKIE_SECURE', isProduction),
    // Strict is what keeps the refresh endpoint free of CSRF: the browser
    // never attaches the cookie to a request initiated by another site.
    sameSite: optional('COOKIE_SAME_SITE', 'strict') as 'strict' | 'lax' | 'none',
    domain: optional('COOKIE_DOMAIN', ''),
  },

  database: {
    host: optional('DB_HOST', 'localhost'),
    port: toInt('DB_PORT', 3306),
    username: optional('DB_USERNAME', 'root'),
    password: optional('DB_PASSWORD', ''),
    name: optional('DB_NAME', 'library_db'),
    // Schema is owned by migrations now. synchronize stays available as an
    // escape hatch but is off unless explicitly switched on.
    synchronize: toBool('DB_SYNCHRONIZE', false),
    migrationsRun: toBool('DB_MIGRATIONS_RUN', true),
    logging: toBool('DB_LOGGING', !isProduction),
  },

  // The frontend dev server is pinned to port 5000 in frontend/craco.config.js.
  corsOrigins: toList('CORS_ORIGINS', ['http://localhost:5000']),

  uploads: {
    // Resolved once so file writes and file reads can never disagree.
    directory: join(process.cwd(), optional('UPLOADS_DIR', 'uploads')),
    maxEbookBytes: toInt('MAX_EBOOK_BYTES', 50 * 1024 * 1024),
    maxCsvBytes: toInt('MAX_CSV_BYTES', 10 * 1024 * 1024),
  },
};

// SameSite=None cookies are ignored by browsers unless they are also Secure,
// which would silently break sign-in rather than fail loudly here.
if (env.cookies.sameSite === 'none' && !env.cookies.secure) {
  throw new Error('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true');
}
