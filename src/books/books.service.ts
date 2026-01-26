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

  /**
   * Export books to CSV format
   * @param filters - Optional filters to apply to the export
   * @returns CSV string
   */
  async exportToCSV(filters?: {
    search?: string;
    status?: BookStatus;
    title?: string;
    author?: string;
    isbn?: string;
    category?: string;
  }): Promise<string> {
    const queryBuilder = this.booksRepository.createQueryBuilder('book');

    // Apply filters if provided
    if (filters?.search) {
      queryBuilder.where(
        '(book.title LIKE :search OR book.author LIKE :search OR book.isbn LIKE :search OR book.category LIKE :search)',
        { search: `%${filters.search}%` }
      );
    }

    if (filters?.status) {
      queryBuilder.andWhere('book.status = :status', { status: filters.status });
    }

    if (filters?.title) {
      queryBuilder.andWhere('book.title LIKE :title', { title: `%${filters.title}%` });
    }

    if (filters?.author) {
      queryBuilder.andWhere('book.author LIKE :author', { author: `%${filters.author}%` });
    }

    if (filters?.isbn) {
      queryBuilder.andWhere('book.isbn LIKE :isbn', { isbn: `%${filters.isbn}%` });
    }

    if (filters?.category) {
      queryBuilder.andWhere('book.category LIKE :category', { category: `%${filters.category}%` });
    }

    // Order by title for better readability
    queryBuilder.orderBy('book.title', 'ASC');

    const books = await queryBuilder.getMany();

    // CSV header
    const headers = [
      'Title',
      'Author',
      'ISBN',
      'Category',
      'Total Copies',
      'Available Copies',
      'Status',
      'Is Ebook',
      'Published Date',
      'Description',
      'Created At',
      'Updated At',
    ];

    // Escape CSV values (handle commas, quotes, newlines)
    const escapeCSV = (value: any): string => {
      if (value === null || value === undefined) {
        return '';
      }
      const stringValue = String(value);
      // If value contains comma, quote, or newline, wrap in quotes and escape quotes
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    // Format date for CSV
    const formatDate = (date: Date | null | undefined): string => {
      if (!date) return '';
      return new Date(date).toISOString().split('T')[0];
    };

    // Build CSV rows
    const rows = books.map((book) => [
      escapeCSV(book.title),
      escapeCSV(book.author),
      escapeCSV(book.isbn),
      escapeCSV(book.category),
      escapeCSV(book.totalCopies),
      escapeCSV(book.availableCopies),
      escapeCSV(book.status),
      escapeCSV(book.isEbook ? 'Yes' : 'No'),
      escapeCSV(formatDate(book.publishedDate)),
      escapeCSV(book.description),
      escapeCSV(formatDate(book.createdAt)),
      escapeCSV(formatDate(book.updatedAt)),
    ]);

    // Combine header and rows
    const csvLines = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ];

    return csvLines.join('\n');
  }

  /**
   * Parse CSV string into array of objects
   * @param csvContent - CSV file content as string
   * @returns Array of parsed book objects
   */
  private parseCSV(csvContent: string): any[] {
    const lines = csvContent.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) {
      throw new BadRequestException('CSV file must contain at least a header row and one data row');
    }

    // Parse header row
    const headers = this.parseCSVLine(lines[0]);
    const expectedHeaders = [
      'Title', 'Author', 'ISBN', 'Category', 'Total Copies',
      'Available Copies', 'Status', 'Is Ebook', 'Published Date',
      'Description', 'Created At', 'Updated At'
    ];

    // Map headers to lowercase for case-insensitive matching
    const headerMap: { [key: string]: string } = {};
    headers.forEach((header, index) => {
      const normalizedHeader = header.trim().toLowerCase();
      headerMap[normalizedHeader] = header;
    });

    // Validate required headers
    const requiredHeaders = ['title', 'author', 'isbn', 'category', 'total copies'];
    for (const required of requiredHeaders) {
      if (!headerMap[required]) {
        throw new BadRequestException(`Missing required column: ${required}`);
      }
    }

    // Parse data rows
    const books: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === 0) continue; // Skip empty rows

      const book: any = {};
      headers.forEach((header, index) => {
        const normalizedHeader = header.trim().toLowerCase();
        const value = values[index]?.trim() || '';

        // Map headers to book properties
        switch (normalizedHeader) {
          case 'title':
            book.title = value;
            break;
          case 'author':
            book.author = value;
            break;
          case 'isbn':
            book.isbn = value;
            break;
          case 'category':
            book.category = value;
            break;
          case 'total copies':
            book.totalCopies = parseInt(value, 10) || 0;
            break;
          case 'available copies':
            book.availableCopies = parseInt(value, 10);
            break;
          case 'status':
            book.status = value.toLowerCase();
            break;
          case 'is ebook':
            book.isEbook = value.toLowerCase() === 'yes' || value.toLowerCase() === 'true' || value === '1';
            break;
          case 'published date':
            book.publishedDate = value || undefined;
            break;
          case 'description':
            book.description = value || undefined;
            break;
        }
      });

      // Validate required fields
      if (!book.title || !book.author || !book.isbn || !book.category) {
        throw new BadRequestException(`Row ${i + 1}: Missing required fields (Title, Author, ISBN, Category)`);
      }

      // Set defaults
      if (book.totalCopies === undefined || isNaN(book.totalCopies)) {
        book.totalCopies = 1;
      }
      if (book.availableCopies === undefined || isNaN(book.availableCopies)) {
        // Default to totalCopies if not specified
        book.availableCopies = book.totalCopies;
      }
      if (!book.status) {
        book.status = 'reviewing';
      }
      // Ensure availableCopies doesn't exceed totalCopies
      if (book.availableCopies > book.totalCopies) {
        book.availableCopies = book.totalCopies;
      }

      books.push(book);
    }

    return books;
  }

  /**
   * Parse a single CSV line, handling quoted values
   * @param line - CSV line string
   * @returns Array of field values
   */
  private parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of field
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    // Add last field
    values.push(current);
    return values;
  }

  /**
   * Import books from CSV file
   * @param csvContent - CSV file content as string
   * @param user - Current user (for auto-approval)
   * @returns Import result with success and error counts
   */
  async importFromCSV(csvContent: string, user?: any): Promise<{
    success: number;
    errors: number;
    results: Array<{ row: number; book: string; status: 'success' | 'error'; message?: string }>;
  }> {
    const books = this.parseCSV(csvContent);
    const results: Array<{ row: number; book: string; status: 'success' | 'error'; message?: string }> = [];
    let successCount = 0;
    let errorCount = 0;

    // Check if user has auto-approve permission
    const isAutoApproved = user?.hasRole?.('book:approve') || false;

    for (let i = 0; i < books.length; i++) {
      const bookData = books[i];
      const rowNumber = i + 2; // +2 because row 1 is header, and arrays are 0-indexed

      try {
        // Check if book with same ISBN already exists
        const existingBook = await this.booksRepository.findOne({
          where: { isbn: bookData.isbn },
        });

        if (existingBook) {
          results.push({
            row: rowNumber,
            book: `${bookData.title} (${bookData.isbn})`,
            status: 'error',
            message: `Book with ISBN ${bookData.isbn} already exists`,
          });
          errorCount++;
          continue;
        }

        // Create book DTO
        const createBookDto: CreateBookDto = {
          title: bookData.title,
          author: bookData.author,
          isbn: bookData.isbn,
          category: bookData.category,
          totalCopies: bookData.totalCopies,
          description: bookData.description,
          publishedDate: bookData.publishedDate,
          isEbook: bookData.isEbook || false,
        };

        // Create book using existing create method
        await this.create(createBookDto, undefined, user);

        results.push({
          row: rowNumber,
          book: `${bookData.title} (${bookData.isbn})`,
          status: 'success',
        });
        successCount++;
      } catch (error: any) {
        results.push({
          row: rowNumber,
          book: `${bookData.title || 'Unknown'} (${bookData.isbn || 'N/A'})`,
          status: 'error',
          message: error.message || 'Unknown error',
        });
        errorCount++;
      }
    }

    return {
      success: successCount,
      errors: errorCount,
      results,
    };
  }
}

