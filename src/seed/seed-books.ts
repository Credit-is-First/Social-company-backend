import { INestApplicationContext } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Book, BookStatus } from '../books/entities/book.entity';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { toDateOnly } from '../common/date-only';

interface BookData {
  title: string;
  author: string;
  isbn: string;
  category: string;
  totalCopies: number;
  description?: string;
  publishedDate?: string;
  isEbook?: boolean;
}

export async function seedBooks(app: INestApplicationContext) {
  const booksRepository = app.get<Repository<Book>>(getRepositoryToken(Book));

  // Read books from JSON file
  const booksFilePath = path.join(process.cwd(), 'temp_data', 'books.json');
  const booksData: BookData[] = JSON.parse(fs.readFileSync(booksFilePath, 'utf-8'));

  console.log(`\n📚 Seeding books...`);
  console.log(`Found ${booksData.length} books in temp_data/books.json`);

  let added = 0;
  let skipped = 0;

  for (const bookData of booksData) {
    try {
      // Check if book with this ISBN already exists
      const existingBook = await booksRepository.findOne({
        where: { isbn: bookData.isbn },
      });

      if (existingBook) {
        console.log(`⏭️  Skipping duplicate book: ${bookData.title} (ISBN: ${bookData.isbn})`);
        skipped++;
        continue;
      }

      // Create book with WORKING status
      const book = booksRepository.create({
        title: bookData.title,
        author: bookData.author,
        isbn: bookData.isbn,
        category: bookData.category,
        totalCopies: bookData.totalCopies,
        availableCopies: bookData.totalCopies,
        description: bookData.description || null,
        publishedDate: bookData.publishedDate ? toDateOnly(bookData.publishedDate) : null,
        isEbook: bookData.isEbook || false,
        status: BookStatus.WORKING,
      });

      await booksRepository.save(book);
      console.log(`✅ Added book: ${bookData.title} (ISBN: ${bookData.isbn})`);
      added++;
    } catch (error) {
      console.error(`❌ Error adding book ${bookData.title}:`, error.message);
    }
  }

  console.log(`\n📚 Books seeding completed:`);
  console.log(`  - Added: ${added} books`);
  console.log(`  - Skipped (duplicates): ${skipped} books`);
}
