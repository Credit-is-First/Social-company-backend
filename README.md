# Library Management System — Backend

NestJS 7 + TypeORM 0.2 + MySQL API for the Electronic Library Management System.
The full feature list, API reference and security notes are in the
[project README](../README.md); this file covers working on the backend itself.

## Requirements

- **Node.js 12.1.0** (declared in `package.json` `engines`). The installed
  `node_modules` — including the native `bcrypt` binding — were built for it.
- MySQL, with a database created for the app (`CREATE DATABASE library_db;`).
- Any new package must run on Node 12.1.0 (socket.io, for example, stays on 2.x to
  match NestJS 7). Install it with the npm that ships with Node 12.1.0 (below), which
  keeps `package-lock.json` in its existing v1 format.

If Node 12.1.0 is not your default `node`, run npm through its own binary and
pass `--scripts-prepend-node-path=true` so child tools (Nest CLI, Jest) use it too:

```bash
"C:/Users/root/AppData/Roaming/nvm/v12.1.0/npm.cmd" --scripts-prepend-node-path=true run start:dev
```

## Configuration

Everything comes from `backend/.env` — copy `.env.example` and fill it in. Nothing
is hardcoded, and `JWT_SECRET` has no default: the process refuses to start
without it.

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET` | — (required) | Use a long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `15m` | Access tokens cannot be revoked early, so keep this short |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Lifetime of a refresh token (the sign-in cookie) |
| `REFRESH_REUSE_GRACE_MS` | `30000` | A just-used refresh token presented again within this window is treated as two tabs racing, not theft |
| `COOKIE_SECURE` / `COOKIE_SAME_SITE` / `COOKIE_DOMAIN` | secure in production / `strict` / — | Refresh cookie; `none` requires `COOKIE_SECURE=true` |
| `RATE_LIMIT_ENABLED` | `true` | Turn off only for load testing |
| `PORT` | `5001` | |
| `NODE_ENV` | `development` | `production` disables Swagger, secures cookies and turns off SQL logging |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | — / `3306` / — / — / — | MySQL connection |
| `DB_MIGRATIONS_RUN` | `true` | Migrations run at startup |
| `DB_SYNCHRONIZE` | `false` | The schema is owned by migrations; leave this off |
| `DB_LOGGING` | on unless production | SQL query logging |
| `CORS_ORIGINS` | `http://localhost:5000` | Comma-separated; also the only origins allowed to open a notification socket |
| `LOAN_REMINDER_INTERVAL_MINUTES` | `60` | How often overdue loans are marked and reminders sent; `0` turns it off |
| `LOAN_DUE_SOON_DAYS` | `1` | The one "due soon" reminder goes out this many days before the due date |
| `OVERDUE_REMINDER_REPEAT_DAYS` | `7` | An overdue loan is reminded again this often until returned |
| `UPLOADS_DIR` | `uploads` | Ebooks and profile photos; never served statically |
| `MAX_EBOOK_BYTES` / `MAX_CSV_BYTES` / `MAX_PHOTO_BYTES` | 50 MB / 10 MB / 5 MB | Upload limits |
| `SEED_MEMBER_PASSWORD` | random | Password for the members `npm run seed:overdue` creates |
| `E2E_DB_NAME` | `library_e2e_db` | Schema the e2e suite drops and recreates |

## Scripts

```bash
npm run start:dev          # watch mode on http://localhost:5001, Swagger at /api (dev only)
npm run build              # compile to dist/
npm run start:prod         # run dist/main
npm test                   # 218 unit tests in 12 suites — no database needed
npm run test:e2e           # end-to-end — needs MySQL; uses its own E2E_DB_NAME schema
npm run migration:generate -- Name   # generate against an EMPTY database
npm run migration:run
npm run migration:revert
npm run seed               # all sample data (books, then overdue loans)
npm run seed -- books      # only the sample books from temp_data/books.json
npm run seed:overdue       # four sample members with overdue loans (1–25 days late);
                           # same as npm run seed -- overdue
```

`seed:overdue` needs approved books with a spare copy; it issues the loans through
the normal staff path (so copies are taken) and leaves them un-reminded, so the next
"Send reminders" or hourly run notifies the borrowers and staff. Re-running it skips
members who already have an open loan. The sample members' password is
`SEED_MEMBER_PASSWORD` if set, otherwise a random one that is never shown.

## Installed-package patch

`postinstall` runs `scripts/fix-nest-cli-watch.js` (idempotent). Without it,
`npm run start:dev` dies with "Cannot destructure property `paths` of 'undefined'"
whenever `tsconfig.json` is re-read without anything changing, and the app it
started keeps running on port 5001 with stale code. TypeScript's watch mode reuses
the previous program with `createProgram(undefined, undefined, …)` there, and
@nestjs/cli 7.6.0 passes those options unchecked to its tsconfig-paths hook. 7.6.0
is the last 7.x, and 8+ needs a newer npm than Node 12.1.0 ships, so the patch makes
the hook fall back to the reused program's options.

## Layout

```
src/
├── auth/         login, registration, refresh-token rotation, profile + photo, guards
├── users/        admin user management, profile-photo storage, privilege containment
├── roles/        role catalogue (roles.constants.ts) and default groups
├── groups/       groups of roles
├── books/        catalogue, approval workflow, ebook upload/download, CSV import/export
├── loans/        lending lifecycle, copy accounting, overdue marking and reminders
├── dashboard/    aggregate statistics
├── notifications/ stored notifications, socket.io gateway, bell API
├── common/       rate-limit decorator and guard; date-only.ts (calendar dates)
├── config/env.ts all configuration, read and validated once
├── migrations/   TypeORM migrations (own the schema)
└── seed/         sample data (books; members with overdue loans)
```

Migrations, in order: `InitialSchema`, `AddProfileFields`, `AddNotifications`,
`AddBookSubmitter` (`books.submittedBy`), `AddLoanReminderTracking`
(`loans.dueSoonNotifiedAt` / `overdueNotifiedAt`).

## Conventions worth knowing

- Request bodies and most query strings are bound to DTO classes; the global
  validation pipe whitelists fields. Inline object types on controller
  parameters are erased at runtime and silently skip validation. A few simple
  query parameters (`GET /notifications?limit`, `GET /loans?userId&bookId`) are
  read individually with `@Query('name')` and checked in the service.
- Secrets (`password`, `securityAnswer`) are stripped by `@Exclude()` on the
  entity plus the global serializer, which does not descend into plain wrapper
  objects — serialise the entity itself if you return `{ user: ... }`.
- Calendar dates (loan borrow/due/return dates, `publishedDate`, `dateOfBirth`)
  are `'YYYY-MM-DD'` strings end to end, never `Date`s: `new Date('2026-09-02')`
  is UTC midnight, and TypeORM writes a `Date`'s local day, so west of UTC the
  day before was stored. Use `src/common/date-only.ts` (`toDateOnly`,
  `todayDateOnly`, `addDays`); the frontend's `src/utils/dates.ts` does the same
  for display.
- `availableCopies` changes only when a loan starts or stops holding a copy, in
  a transaction that locks the book row (and the loan row, for status changes).
- Every path that moves roles — user role/group assignment, account creation,
  and group create/update/delete — goes through `src/roles/privilege.ts`:
  nobody can grant or remove a role they do not hold, or reset the password of,
  block or delete an account holding one. New code that changes roles must call it too. The
  Super Admin group's roles are fixed; the role changes hands only through
  `POST /users/:id/transfer-super-admin`. Blocking, unblocking and deleting a user
  use the same rule (`assertCanActAs`): you must hold every role the account holds.
- Notifications are sent through `NotificationsService` only after the change
  that caused them has been saved (for loans, after the transaction commits), and
  never throw: a delivery failure is logged, not reported as a failed action.
  Sockets authenticate with an `authenticate` message carrying the access token,
  not a query-string token, and receive only their own user's room. A signed-in
  socket is dropped (`unauthorized`) when that token expires, and at once when
  the account is blocked or deleted (`NotificationsService.disconnectUser`).
- `LoanRemindersService` runs on a timer (every `LOAN_REMINDER_INTERVAL_MINUTES`,
  default 60, and 15 s after startup; 0 turns it off). It marks past-due active
  loans `overdue` and sends due-soon and overdue reminders. Dates are compared with
  the database's `CURDATE()`, and each reminder is claimed with a conditional
  `UPDATE` before it is sent, so overlapping runs cannot double-send.
  `POST /loans/reminders/run` runs a pass on demand.
