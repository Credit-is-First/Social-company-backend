import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { Book } from './entities/book.entity';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class BooksService {
  constructor(
    @InjectRepository(Book)
    private booksRepository: Repository<Book>,
  ) {}

  async create(createBookDto: CreateBookDto, file?: Express.Multer.File, user?: any): Promise<Book> {
    // Auto-approve if created by admin or librarian, otherwise needs approval
    const userRoleNames = user?.roles?.map((r: any) => r.name) || [];
    const isAutoApproved = userRoleNames.includes('admin') || userRoleNames.includes('librarian');
    
    const bookData: Partial<Book> = {
      title: createBookDto.title,
      author: createBookDto.author,
      isbn: createBookDto.isbn,
      category: createBookDto.category,
      totalCopies: createBookDto.totalCopies,
      availableCopies: createBookDto.totalCopies,
      description: createBookDto.description,
      publishedDate: createBookDto.publishedDate ? new Date(createBookDto.publishedDate) : undefined,
      isEbook: createBookDto.isEbook || false,
      isApproved: isAutoApproved,
    };

    if (isAutoApproved && user?.id) {
      bookData.approvedBy = user.id;
      bookData.approvedAt = new Date();
    }

    // Save file to disk only after validation passes
    if (file && createBookDto.isEbook && file.buffer) {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'ebooks');
      // Ensure directory exists
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const filename = `file-${uniqueSuffix}${ext}`;
      const filePath = path.join(uploadsDir, filename);
      
      // Write file to disk
      fs.writeFileSync(filePath, file.buffer);
      bookData.filePath = `/uploads/ebooks/${filename}`;
    }

    const book = this.booksRepository.create(bookData);
    const savedBook = await this.booksRepository.save(book);
    return savedBook as Book;
  }

  async approve(id: string, userId: string): Promise<Book> {
    const book = await this.findOne(id);
    book.isApproved = true;
    book.approvedBy = userId;
    book.approvedAt = new Date();
    return await this.booksRepository.save(book);
  }

  async decline(id: string, userId: string): Promise<Book> {
    const book = await this.findOne(id);
    book.isApproved = false;
    book.approvedBy = userId;
    book.approvedAt = new Date();
    return await this.booksRepository.save(book);
  }

  async findAll(): Promise<Book[]> {
    return await this.booksRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Book> {
    const book = await this.booksRepository.findOne({
      where: { id },
      relations: ['loans'],
    });
    if (!book) {
      throw new NotFoundException(`Book with ID ${id} not found`);
    }
    return book;
  }

  async update(id: string, updateBookDto: UpdateBookDto, file?: Express.Multer.File): Promise<Book> {
    const book = await this.findOne(id);
    
    if (updateBookDto.totalCopies !== undefined) {
      const difference = updateBookDto.totalCopies - book.totalCopies;
      book.availableCopies = Math.max(0, book.availableCopies + difference);
    }

    if (file && updateBookDto.isEbook && file.buffer) {
      // Delete old file if exists
      if (book.filePath) {
        const oldFilePath = path.join(process.cwd(), book.filePath);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }
      
      // Save new file to disk
      const uploadsDir = path.join(process.cwd(), 'uploads', 'ebooks');
      // Ensure directory exists
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const filename = `file-${uniqueSuffix}${ext}`;
      const filePath = path.join(uploadsDir, filename);
      
      // Write file to disk
      fs.writeFileSync(filePath, file.buffer);
      book.filePath = `/uploads/ebooks/${filename}`;
    }

    // Convert publishedDate string to Date if provided
    if (updateBookDto.publishedDate !== undefined) {
      book.publishedDate = updateBookDto.publishedDate ? new Date(updateBookDto.publishedDate) : null;
    }

    // Update other fields
    if (updateBookDto.title !== undefined) book.title = updateBookDto.title;
    if (updateBookDto.author !== undefined) book.author = updateBookDto.author;
    if (updateBookDto.isbn !== undefined) book.isbn = updateBookDto.isbn;
    if (updateBookDto.category !== undefined) book.category = updateBookDto.category;
    if (updateBookDto.description !== undefined) book.description = updateBookDto.description;
    if (updateBookDto.isEbook !== undefined) book.isEbook = updateBookDto.isEbook;

    const savedBook = await this.booksRepository.save(book);
    return savedBook as Book;
  }

  async remove(id: string): Promise<void> {
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

