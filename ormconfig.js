/*
 * Configuration for the TypeORM 0.2 CLI only (migration generate/run/revert).
 *
 * The running application does NOT read this file — it builds its connection
 * options in src/app.module.ts from src/config/env.ts. Both read the same
 * environment variables, so keep them in step.
 */
require('dotenv').config();

const toInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
};

module.exports = {
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: toInt(process.env.DB_PORT, 3306),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'library_db',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
  cli: {
    migrationsDir: 'src/migrations',
  },
};
