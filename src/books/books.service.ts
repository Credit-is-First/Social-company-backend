import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { Book, BookStatus } from './entities/book.entity';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class BooksService {
  constructor(
    @InjectRepository(Book)
    private booksRepository: Repository<Book>,
  ) {}

  async create(createBookDto: CreateBookDto, file?: Express.Multer.File, user?: any): Promise<Book> {
    // Auto-approve if created by user with book:approve role, otherwise needs approval
    const isAutoApproved = user?.hasRole?.('book:approve') || false;
    
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
      status: isAutoApproved ? BookStatus.APPROVED : BookStatus.REVIEWING,
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
    book.status = BookStatus.APPROVED;
    book.approvedBy = userId;
    book.approvedAt = new Date();
    book.rejectionReason = null; // Clear rejection reason when approving
    book.deprecationReason = null; // Clear deprecation reason when approving
    return await this.booksRepository.save(book);
  }

  async decline(id: string, userId: string, reason?: string): Promise<Book> {
    const book = await this.findOne(id);
    book.status = BookStatus.DECLINED;
    book.approvedBy = userId;
    book.approvedAt = new Date();
    book.rejectionReason = reason || null;
    return await this.booksRepository.save(book);
  }

  async deprecate(id: string, userId: string, reason?: string): Promise<Book> {
    const book = await this.findOne(id);
    book.status = BookStatus.DEPRECATED;
    book.approvedBy = userId;
    book.approvedAt = new Date();
    book.deprecationReason = reason || null;
    book.rejectionReason = null; // Clear rejection reason when deprecating
    return await this.booksRepository.save(book);
  }

  async findAll(excludeDeprecated: boolean = true): Promise<Book[]> {
    const queryBuilder = this.booksRepository.createQueryBuilder('book');
    
    if (excludeDeprecated) {
      queryBuilder.where('book.status != :status', { status: BookStatus.DEPRECATED });
    }
    
    return await queryBuilder.orderBy('book.createdAt', 'DESC').getMany();
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

  async update(id: string, updateBookDto: UpdateBookDto, file?: Express.Multer.File, requestReview?: boolean): Promise<Book> {
    const book = await this.findOne(id);
    
    // Prevent editing approved or reviewing books directly
    if ((book.status === BookStatus.APPROVED || book.status === BookStatus.REVIEWING) && !requestReview) {
      throw new BadRequestException('Cannot edit approved or reviewing books. Please deprecate the book first.');
    }
    
    // Allow editing declined books - they can be edited and then request review
    
    // If requesting review from deprecated, working, or declined book, change status to reviewing
    if (requestReview && (book.status === BookStatus.DEPRECATED || book.status === BookStatus.WORKING || book.status === BookStatus.DECLINED)) {
      book.status = BookStatus.REVIEWING;
      book.deprecationReason = null; // Clear deprecation reason when requesting review
      book.rejectionReason = null; // Clear rejection reason when requesting review
      book.approvedBy = null;
      book.approvedAt = null;
    }
    
    // If editing a deprecated book, change status to working
    if (book.status === BookStatus.DEPRECATED && !requestReview) {
      book.status = BookStatus.WORKING;
    }
    
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

  async search(query: string, excludeDeprecated: boolean = true): Promise<Book[]> {
    const queryBuilder = this.booksRepository
      .createQueryBuilder('book')
      .where('(book.title LIKE :query OR book.author LIKE :query OR book.isbn LIKE :query OR book.category LIKE :query)', { query: `%${query}%` });
    
    if (excludeDeprecated) {
      queryBuilder.andWhere('book.status != :deprecatedStatus', { deprecatedStatus: BookStatus.DEPRECATED });
      queryBuilder.andWhere('book.status != :workingStatus', { workingStatus: BookStatus.WORKING });
    }
    
    return await queryBuilder.orderBy('book.createdAt', 'DESC').getMany();
  }

  async findWithPagination(paginationDto: {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
    status?: BookStatus;
    title?: string;
    author?: string;
    isbn?: string;
    category?: string;
  }): Promise<{ data: Book[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = paginationDto.page || 1;
    const limit = paginationDto.limit || 10;
    const skip = (page - 1) * limit;

    const queryBuilder = this.booksRepository.createQueryBuilder('book');

    // Global search
    if (paginationDto.search) {
      queryBuilder.where(
        '(book.title LIKE :search OR book.author LIKE :search OR book.isbn LIKE :search OR book.category LIKE :search)',
        { search: `%${paginationDto.search}%` }
      );
    }

    // Column-specific filters
    if (paginationDto.status) {
      queryBuilder.andWhere('book.status = :status', { status: paginationDto.status });
    } else {
      // Exclude deprecated and in_progress books by default unless explicitly requested
      queryBuilder.andWhere('book.status != :deprecatedStatus', { deprecatedStatus: BookStatus.DEPRECATED });
      queryBuilder.andWhere('book.status != :workingStatus', { workingStatus: BookStatus.WORKING });
    }
    if (paginationDto.title) {
      queryBuilder.andWhere('book.title LIKE :title', { title: `%${paginationDto.title}%` });
    }
    if (paginationDto.author) {
      queryBuilder.andWhere('book.author LIKE :author', { author: `%${paginationDto.author}%` });
    }
    if (paginationDto.isbn) {
      queryBuilder.andWhere('book.isbn LIKE :isbn', { isbn: `%${paginationDto.isbn}%` });
    }
    if (paginationDto.category) {
      queryBuilder.andWhere('book.category LIKE :category', { category: `%${paginationDto.category}%` });
    }

    // Sorting
    const sortBy = paginationDto.sortBy || 'createdAt';
    const sortOrder = paginationDto.sortOrder || 'DESC';
    const validSortFields = ['title', 'author', 'isbn', 'category', 'status', 'createdAt', 'updatedAt', 'totalCopies', 'availableCopies'];
    const finalSortBy = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    queryBuilder.orderBy(`book.${finalSortBy}`, sortOrder);

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination
    queryBuilder.skip(skip).take(limit);

    const data = await queryBuilder.getMany();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}

