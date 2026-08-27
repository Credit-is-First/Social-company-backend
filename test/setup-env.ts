/*
 * Runs before the test module graph is loaded.
 *
 * src/config/env.ts calls dotenv.config(), which never overwrites variables
 * that are already set — so assigning them here wins over backend/.env and
 * keeps the end-to-end suite off the development database.
 */
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.E2E_DB_NAME || 'library_e2e_db';
process.env.DB_LOGGING = 'false';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-only-secret-not-used-anywhere-else';
// Short access token so the refresh flow is exercised the same way it is in
// production, without making the suite wait.
process.env.JWT_EXPIRES_IN = '15m';
// Small enough that the suite can exercise both sides of the reuse window —
// the benign race and the genuine replay — without a 30 second wait.
process.env.REFRESH_REUSE_GRACE_MS = '1000';
