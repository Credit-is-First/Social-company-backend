import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { seedBooks } from './seed-books';

async function runSeeds() {
  console.log('🌱 Starting database seeding...\n');

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    // Run all seed functions
    await seedBooks(app);

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
