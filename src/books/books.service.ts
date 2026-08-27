import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { BookFilterDto, PaginationDto, BOOK_SORT_FIELDS } from './dto/pagination.dto';
import { Book, BookStatus } from './entities/book.entity';
import { Loan } from '../loans/entities/loan.entity';
import { env } from '../config/env';
import * as fs from 'fs';
import * as path from 'path';

const EBOOK_SUBDIRECTORY = 'ebooks';

export interface PaginatedBooks {
  data: Book[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface CreateBookOverrides {
  status?: BookStatus;
  availableCopies?: number;
}

@Injectable()
export class BooksService {
  constructor(
    @InjectRepository(Book)
    private booksRepository: Repository<Book>,
    @InjectRepository(Loan)
    private loansRepository: Repository<Loan>,
  ) {}

  // ---------------------------------------------------------------------------
  // File storage
  // ---------------------------------------------------------------------------

  private get ebooksDirectory(): string {
    return path.join(env.uploads.directory, EBOOK_SUBDIRECTORY);
  }

  /**
   * Resolves a stored filePath to an absolute path. Only the basename is used,
   * so a malformed or tampered value can never escape the uploads directory.
   */
  resolveEbookPath(filePath: string): string | null {
    if (!filePath) {
      return null;
    }
    const filename = path.basename(filePath);
    if (!filename || filename === '.' || filename === '..') {
      return null;
    }
    return path.join(this.ebooksDirectory, filename);
  }

  private storeEbook(file: Express.Multer.File): string {
    if (!fs.existsSync(this.ebooksDirectory)) {
      fs.mkdirSync(this.ebooksDirectory, { recursive: true });
    }

    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    const filename = `file-${uniqueSuffix}${ext}`;
    fs.writeFileSync(path.join(this.ebooksDirectory, filename), file.buffer);

    return `/${path.posix.join('uploads', EBOOK_SUBDIRECTORY, filename)}`;
  }

  private deleteEbook(filePath: string): void {
    const absolutePath = this.resolveEbookPath(filePath);
    if (absolutePath && fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async create(
    createBookDto: CreateBookDto,
    file?: Express.Multer.File,
    user?: any,
    overrides: CreateBookOverrides = {},
  ): Promise<Book> {
    // Surface the duplicate as a 409 instead of letting the unique index throw
    // an unhandled driver error (which surfaced as a 500).
    const existing = await this.booksRepository.findOne({ where: { isbn: createBookDto.isbn } });
    if (existing) {
      throw new ConflictException(`A book with ISBN ${createBookDto.isbn} already exists`);
    }

    // Auto-approve if created by user with book:approve role, otherwise needs approval
    const isAutoApproved = (user && typeof user.hasRole === 'function' && user.hasRole('book:approve')) || false;
    const status = overrides.status || (isAutoApproved ? BookStatus.APPROVED : BookStatus.REVIEWING);

    const totalCopies = createBookDto.totalCopies;
    const availableCopies =
      overrides.availableCopies === undefined
        ? totalCopies
        : Math.max(0, Math.min(overrides.availableCopies, totalCopies));

    const bookData: Partial<Book> = {
      title: createBookDto.title,
      author: createBookDto.author,
      isbn: createBookDto.isbn,
      category: createBookDto.category,
      totalCopies,
      availableCopies,
      description: createBookDto.description,
      publishedDate: createBookDto.publishedDate ? new Date(createBookDto.publishedDate) : undefined,
      isEbook: createBookDto.isEbook || false,
      status,
    };

    if (status === BookStatus.APPROVED && user && user.id) {
      bookData.approvedBy = user.id;
      bookData.approvedAt = new Date();
    }

    // Save file to disk only after validation passes
    if (file && createBookDto.isEbook && file.buffer) {
      bookData.filePath = this.storeEbook(file);
    }

    const book = this.booksRepository.create(bookData);
    return await this.booksRepository.save(book);
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

  async update(
    id: string,
    updateBookDto: UpdateBookDto,
    file?: Express.Multer.File,
    requestReview?: boolean,
  ): Promise<Book> {
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

    if (updateBookDto.isbn !== undefined && updateBookDto.isbn !== book.isbn) {
      const duplicate = await this.booksRepository.findOne({ where: { isbn: updateBookDto.isbn } });
      if (duplicate && duplicate.id !== book.id) {
        throw new ConflictException(`A book with ISBN ${updateBookDto.isbn} already exists`);
      }
    }

    if (updateBookDto.totalCopies !== undefined) {
      const onLoan = Math.max(0, book.totalCopies - book.availableCopies);
      if (updateBookDto.totalCopies < onLoan) {
        throw new BadRequestException(
          `Cannot reduce total copies to ${updateBookDto.totalCopies}: ${onLoan} ${onLoan === 1 ? 'copy is' : 'copies are'} currently on loan.`,
        );
      }
      book.totalCopies = updateBookDto.totalCopies;
      book.availableCopies = updateBookDto.totalCopies - onLoan;
    }

    if (file && updateBookDto.isEbook && file.buffer) {
      if (book.filePath) {
        this.deleteEbook(book.filePath);
      }
      book.filePath = this.storeEbook(file);
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

    return await this.booksRepository.save(book);
  }

  async remove(id: string): Promise<void> {
    const book = await this.findOne(id);

    // Loans reference this book by foreign key; deleting underneath them used to
    // fail with a raw driver error.
    const loanCount = await this.loansRepository.count({ where: { bookId: id } });
    if (loanCount > 0) {
      throw new BadRequestException(
        `Cannot delete this book: it has ${loanCount} loan ${loanCount === 1 ? 'record' : 'records'}. Deprecate it instead.`,
      );
    }

    if (book.filePath) {
      this.deleteEbook(book.filePath);
    }

    await this.booksRepository.remove(book);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async findOne(id: string): Promise<Book> {
    const book = await this.booksRepository.findOne({ where: { id } });
    if (!book) {
      throw new NotFoundException(`Book with ID ${id} not found`);
    }
    return book;
  }

  /** Applies the shared search/column filters to a query builder. */
  private applyFilters(
    queryBuilder: SelectQueryBuilder<Book>,
    filters: BookFilterDto,
    includeNonApproved: boolean,
  ): void {
    if (filters.search) {
      queryBuilder.andWhere(
        '(book.title LIKE :search OR book.author LIKE :search OR book.isbn LIKE :search OR book.category LIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    if (!includeNonApproved) {
      // Callers without book:read only ever see the published catalogue,
      // whatever status they ask for.
      queryBuilder.andWhere('book.status = :approvedStatus', { approvedStatus: BookStatus.APPROVED });
    } else if (filters.status) {
      queryBuilder.andWhere('book.status = :status', { status: filters.status });
    } else {
      // Default management view hides drafts and retired titles.
      queryBuilder.andWhere('book.status NOT IN (:...hiddenStatuses)', {
        hiddenStatuses: [BookStatus.DEPRECATED, BookStatus.WORKING],
      });
    }

    if (filters.title) {
      queryBuilder.andWhere('book.title LIKE :title', { title: `%${filters.title}%` });
    }
    if (filters.author) {
      queryBuilder.andWhere('book.author LIKE :author', { author: `%${filters.author}%` });
    }
    if (filters.isbn) {
      queryBuilder.andWhere('book.isbn LIKE :isbn', { isbn: `%${filters.isbn}%` });
    }
    if (filters.category) {
      queryBuilder.andWhere('book.category LIKE :category', { category: `%${filters.category}%` });
    }
  }

  async findWithPagination(
    paginationDto: PaginationDto,
    includeNonApproved: boolean = false,
  ): Promise<PaginatedBooks> {
    const page = paginationDto.page || 1;
    const limit = paginationDto.limit || 10;
    const skip = (page - 1) * limit;

    const queryBuilder = this.booksRepository.createQueryBuilder('book');
    this.applyFilters(queryBuilder, paginationDto, includeNonApproved);

    // Both halves of the ORDER BY are re-checked against allow-lists here, so a
    // bypassed or stale DTO can still never inject SQL.
    const sortBy = BOOK_SORT_FIELDS.indexOf(paginationDto.sortBy) !== -1 ? paginationDto.sortBy : 'createdAt';
    const sortOrder = paginationDto.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    queryBuilder.orderBy(`book.${sortBy}`, sortOrder);

    const total = await queryBuilder.getCount();
    queryBuilder.skip(skip).take(limit);
    const data = await queryBuilder.getMany();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  // ---------------------------------------------------------------------------
  // CSV export / import
  // ---------------------------------------------------------------------------

  /**
   * Export books to CSV format
   * @param filters - Optional filters to apply to the export
   * @returns CSV string
   */
  async exportToCSV(filters: BookFilterDto = {}): Promise<string> {
    const queryBuilder = this.booksRepository.createQueryBuilder('book');
    this.applyFilters(queryBuilder, filters, true);
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
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) {
      throw new BadRequestException('CSV file must contain at least a header row and one data row');
    }

    // Parse header row
    const headers = this.parseCSVLine(lines[0]);

    // Map headers to lowercase for case-insensitive matching
    const headerMap: { [key: string]: string } = {};
    headers.forEach((header) => {
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

    const validStatuses: string[] = Object.keys(BookStatus).map(key => BookStatus[key]);

    // Parse data rows
    const books: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === 0) continue; // Skip empty rows

      const book: any = {};
      headers.forEach((header, index) => {
        const normalizedHeader = header.trim().toLowerCase();
        const value = (values[index] || '').trim();

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
            book.totalCopies = parseInt(value, 10);
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
      if (book.totalCopies === undefined || isNaN(book.totalCopies) || book.totalCopies < 0) {
        book.totalCopies = 1;
      }
      if (book.availableCopies === undefined || isNaN(book.availableCopies) || book.availableCopies < 0) {
        // Default to totalCopies if not specified
        book.availableCopies = book.totalCopies;
      }
      if (book.status && validStatuses.indexOf(book.status) === -1) {
        throw new BadRequestException(
          `Row ${i + 1}: Unknown status "${book.status}". Expected one of: ${validStatuses.join(', ')}`,
        );
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

    // Only an approver may import rows that are already approved; for everyone
    // else the requested status is ignored and the book enters review.
    const canApprove = (user && typeof user.hasRole === 'function' && user.hasRole('book:approve')) || false;

    for (let i = 0; i < books.length; i++) {
      const bookData = books[i];
      const rowNumber = i + 2; // +2 because row 1 is header, and arrays are 0-indexed

      try {
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

        // Columns the UI advertises as supported, now actually honoured.
        await this.create(createBookDto, undefined, user, {
          status: canApprove && bookData.status ? (bookData.status as BookStatus) : undefined,
          availableCopies: bookData.availableCopies,
        });

        results.push({
          row: rowNumber,
          book: `${bookData.title} (${bookData.isbn})`,
          status: 'success',
        });
        successCount++;
      } catch (error) {
        results.push({
          row: rowNumber,
          book: `${bookData.title || 'Unknown'} (${bookData.isbn || 'N/A'})`,
          status: 'error',
          message: (error && error.message) || 'Unknown error',
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

/**
 * Escape a CSV value: quote it when needed, and neutralise leading characters
 * that spreadsheet software would otherwise evaluate as a formula.
 */
export function escapeCSV(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  let stringValue = String(value);

  if (/^[=+\-@\t\r]/.test(stringValue)) {
    stringValue = `'${stringValue}`;
  }

  if (stringValue.indexOf(',') !== -1 || stringValue.indexOf('"') !== -1 || stringValue.indexOf('\n') !== -1) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}
