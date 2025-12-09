import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { Book } from './entities/book.entity';

@Injectable()
export class BooksService {
  constructor(
    @InjectRepository(Book)
    private booksRepository: Repository<Book>,
  ) {}

  async create(createBookDto: CreateBookDto, file?: Express.Multer.File): Promise<Book> {
    const bookData: Partial<Book> = {
      ...createBookDto,
      availableCopies: createBookDto.totalCopies,
      isEbook: createBookDto.isEbook || false,
    };

    if (file && createBookDto.isEbook) {
      bookData.filePath = `/uploads/ebooks/${file.filename}`;
    }

    const book = this.booksRepository.create(bookData);
    const savedBook = await this.booksRepository.save(book);
    return savedBook as Book;
  }

  async findAll(): Promise<Book[]> {
    return await this.booksRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<Book> {
    const book = await this.booksRepository.findOne(id, {
      relations: ['loans'],
    });
    if (!book) {
      throw new NotFoundException(`Book with ID ${id} not found`);
    }
    return book;
  }

  async update(id: number, updateBookDto: UpdateBookDto, file?: Express.Multer.File): Promise<Book> {
    const book = await this.findOne(id);
    
    if (updateBookDto.totalCopies !== undefined) {
      const difference = updateBookDto.totalCopies - book.totalCopies;
      book.availableCopies = Math.max(0, book.availableCopies + difference);
    }

    if (file && updateBookDto.isEbook) {
      // Delete old file if exists
      if (book.filePath) {
        const fs = require('fs');
        const path = require('path');
        const oldFilePath = path.join(process.cwd(), book.filePath);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }
      book.filePath = `/uploads/ebooks/${file.filename}`;
    }

    Object.assign(book, updateBookDto);
    const savedBook = await this.booksRepository.save(book);
    return savedBook as Book;
  }

  async remove(id: number): Promise<void> {
    const book = await this.findOne(id);
    await this.booksRepository.remove(book);
  }

  async search(query: string): Promise<Book[]> {
    return await this.booksRepository
      .createQueryBuilder('book')
      .where('book.title LIKE :query', { query: `%${query}%` })
      .orWhere('book.author LIKE :query', { query: `%${query}%` })
      .orWhere('book.isbn LIKE :query', { query: `%${query}%` })
      .orWhere('book.category LIKE :query', { query: `%${query}%` })
      .orderBy('book.createdAt', 'DESC')
      .getMany();
  }
}

