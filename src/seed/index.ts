import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { seedBooks } from './seed-books';
import { seedOverdueLoans } from './seed-overdue-loans';

const SEEDS: { [name: string]: (app: any) => Promise<void> } = {
  books: seedBooks,
  overdue: seedOverdueLoans,
};

/**
 * `npm run seed` runs every seed; `npm run seed -- overdue` (or
 * `npm run seed:overdue`) runs only the named ones.
 */
async function runSeeds() {
  const requested = process.argv.slice(2);
  const unknown = requested.filter(name => !SEEDS[name]);
  if (unknown.length > 0) {
    console.error(`Unknown seed: ${unknown.join(', ')}. Available: ${Object.keys(SEEDS).join(', ')}`);
    process.exit(1);
  }
  const names = requested.length > 0 ? requested : Object.keys(SEEDS);

  console.log('🌱 Starting database seeding...\n');

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    for (const name of names) {
      await SEEDS[name](app);
    }

    console.log('\n✨ All seeds completed successfully!');
    await app.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seeding process failed:', error);
    await app.close();
    process.exit(1);
  }
}

runSeeds();
