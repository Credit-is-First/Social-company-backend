# Library Management System — Backend

NestJS 7 + TypeORM 0.2 + MySQL API for the Electronic Library Management System.
The full feature list, API reference and security notes are in the
[project README](../README.md); this file covers working on the backend itself.

## Requirements

- **Node.js 12.1.0** (declared in `package.json` `engines`). The installed
  `node_modules` — including the native `bcrypt` binding — were built for it.
- MySQL, with a database created for the app (`CREATE DATABASE library_db;`).
- The project is developed offline: `npm install` cannot fetch new packages, so
  work with what is already in `node_modules`.

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
| `PORT` | `5001` | |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | | MySQL connection |
| `DB_MIGRATIONS_RUN` | `true` | Migrations run at startup |
| `DB_SYNCHRONIZE` | `false` | The schema is owned by migrations; leave this off |
| `CORS_ORIGINS` | `http://localhost:5000` | Comma-separated |
| `UPLOADS_DIR` | `uploads` | Ebooks and profile photos; never served statically |
| `MAX_EBOOK_BYTES` / `MAX_CSV_BYTES` / `MAX_PHOTO_BYTES` | 50 MB / 10 MB / 5 MB | Upload limits |

See `.env.example` for the refresh-token, cookie and rate-limit settings.

## Scripts

```bash
npm run start:dev          # watch mode on http://localhost:5001, Swagger at /api (dev only)
npm run build              # compile to dist/
npm run start:prod         # run dist/main
npm test                   # unit tests — no database needed
npm run test:e2e           # end-to-end — needs MySQL; uses its own E2E_DB_NAME schema
npm run migration:generate -- Name   # generate against an EMPTY database
npm run migration:run
npm run migration:revert
npm run seed               # sample books from temp_data/books.json
```

## Layout

```
src/
├── auth/         login, registration, refresh-token rotation, profile + photo, guards
├── users/        admin user management, profile-photo storage, privilege containment
├── roles/        role catalogue (roles.constants.ts) and default groups
├── groups/       groups of roles
├── books/        catalogue, approval workflow, ebook upload/download, CSV import/export
├── loans/        lending lifecycle and copy accounting
├── dashboard/    aggregate statistics
├── common/       rate-limit decorator and guard
├── config/env.ts all configuration, read and validated once
├── migrations/   TypeORM migrations (own the schema)
└── seed/         sample data
```

## Conventions worth knowing

- Every request body and query string is bound to a DTO class; the global
  validation pipe whitelists fields. Inline object types on controller
  parameters are erased at runtime and silently skip validation.
- Secrets (`password`, `securityAnswer`) are stripped by `@Exclude()` on the
  entity plus the global serializer, which does not descend into plain wrapper
  objects — serialise the entity itself if you return `{ user: ... }`.
- `availableCopies` changes only when a loan starts or stops holding a copy, in
  a transaction that locks the book row (and the loan row, for status changes).
- Every path that moves roles — user role/group assignment, account creation,
  and group create/update/delete — goes through `src/roles/privilege.ts`:
  nobody can grant or remove a role they do not hold, or reset the password of
  an account holding one. New code that changes roles must call it too. The
  Super Admin group's roles are fixed; the role changes hands only through
  `POST /users/:id/transfer-super-admin`.
