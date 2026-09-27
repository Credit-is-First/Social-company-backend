import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { BooksService } from './books.service';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { BookFilterDto, PaginationDto } from './dto/pagination.dto';
import { BookReasonDto } from './dto/book-reason.dto';
import { Book, BookStatus } from './entities/book.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { HasRoles } from '../auth/decorators/roles.decorator';
import { Roles } from '../roles/roles.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { env } from '../config/env';
import { memoryStorage } from 'multer';
import { decodeCsvBuffer } from './csv-encoding';
import * as fs from 'fs';
import * as path from 'path';

const EBOOK_MIME_TYPES = ['application/pdf', 'application/epub+zip', 'application/x-mobipocket-ebook'];

const ebookUploadOptions = {
  storage: memoryStorage(), // Use memory storage to validate before saving to disk
  fileFilter: (req, file, cb) => {
    if (EBOOK_MIME_TYPES.indexOf(file.mimetype) !== -1) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Invalid file type. Only PDF, EPUB, and MOBI files are allowed.'), false);
    }
  },
  limits: {
    fileSize: env.uploads.maxEbookBytes,
  },
};

@ApiTags('books')
@Controller('books')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  /** book:read is the "see everything" permission; everyone else gets the published catalogue. */
  private canReadAllStatuses(user?: User): boolean {
    return !!(user && typeof user.hasRole === 'function' && user.hasRole(Roles.BOOK_READ));
  }

  @Post()
  @HasRoles(Roles.BOOK_CREATE)
  @UseInterceptors(FileInterceptor('file', ebookUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create a new book (Requires approval for regular users)' })
  @ApiResponse({ status: 201, description: 'Book created successfully', type: Book })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        author: { type: 'string' },
        isbn: { type: 'string' },
        category: { type: 'string' },
        totalCopies: { type: 'number' },
        description: { type: 'string' },
        publishedDate: { type: 'string', format: 'date' },
        isEbook: { type: 'boolean' },
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  create(@Body() createBookDto: CreateBookDto, @UploadedFile() file?: Express.Multer.File, @CurrentUser() user?: User) {
    return this.booksService.create(createBookDto, file, user);
  }

  @Get()
  @ApiOperation({ summary: 'Get books with pagination (authenticated)' })
  @ApiResponse({ status: 200, description: 'Paginated list of books' })
  findAll(@Query() paginationDto: PaginationDto, @CurrentUser() user?: User) {
    return this.booksService.findWithPagination(paginationDto, this.canReadAllStatuses(user));
  }

  @Get('export/csv')
  @HasRoles(Roles.BOOK_READ)
  @ApiOperation({ summary: 'Export books to CSV file' })
  @ApiResponse({ status: 200, description: 'CSV file generated successfully' })
  async exportToCSV(@Query() filters: BookFilterDto, @Res() res: Response) {
    const csv = await this.booksService.exportToCSV(filters);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=books-export.csv');
    res.send(csv);
  }

  @Post('import/csv')
  @HasRoles(Roles.BOOK_CREATE)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: (req, file, cb) => {
      // Accept CSV files
      const allowedMimes = ['text/csv', 'application/csv', 'text/plain'];
      const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));

      if (allowedMimes.indexOf(file.mimetype) !== -1 || fileExtension === '.csv') {
        cb(null, true);
      } else {
        cb(new BadRequestException('Invalid file type. Only CSV files are allowed.'), false);
      }
    },
    limits: {
      fileSize: env.uploads.maxCsvBytes,
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import books from CSV file' })
  @ApiResponse({ status: 200, description: 'Books imported successfully' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async importFromCSV(@UploadedFile() file: Express.Multer.File, @CurrentUser() user?: User) {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    // Excel's plain "CSV" is GBK or Big5 on Chinese Windows, not UTF-8.
    const { text } = decodeCsvBuffer(file.buffer);
    return await this.booksService.importFromCSV(text, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a book by ID (authenticated)' })
  @ApiResponse({ status: 200, description: 'Book found', type: Book })
  @ApiResponse({ status: 404, description: 'Book not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user?: User) {
    const book = await this.booksService.findOne(id);
    if (book.status !== BookStatus.APPROVED && !this.canReadAllStatuses(user)) {
      throw new NotFoundException(`Book with ID ${id} not found`);
    }
    return book;
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Download the ebook file for a book (authenticated)' })
  @ApiResponse({ status: 200, description: 'Ebook file stream' })
  @ApiResponse({ status: 404, description: 'Book or file not found' })
  async downloadFile(@Param('id') id: string, @Res() res: Response, @CurrentUser() user?: User) {
    const book = await this.booksService.findOne(id);

    // Uploads are no longer served as unauthenticated static files, so this is
    // the only way to reach them.
    if (book.status !== BookStatus.APPROVED && !this.canReadAllStatuses(user)) {
      throw new NotFoundException(`Book with ID ${id} not found`);
    }

    const absolutePath = book.isEbook ? this.booksService.resolveEbookPath(book.filePath) : null;
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      throw new NotFoundException('No ebook file is attached to this book');
    }

    const safeTitle = (book.title || 'ebook').replace(/[^a-zA-Z0-9 ._-]/g, '_').trim() || 'ebook';
    res.download(absolutePath, `${safeTitle}${path.extname(absolutePath)}`);
  }

  @Patch(':id/approve')
  @HasRoles(Roles.BOOK_APPROVE)
  @ApiOperation({ summary: 'Approve a book' })
  @ApiResponse({ status: 200, description: 'Book approved successfully', type: Book })
  approve(@Param('id') id: string, @CurrentUser() user: User) {
    return this.booksService.approve(id, user.id);
  }

  @Patch(':id/decline')
  @HasRoles(Roles.BOOK_DECLINE)
  @ApiOperation({ summary: 'Decline a book' })
  @ApiResponse({ status: 200, description: 'Book declined successfully', type: Book })
  decline(@Param('id') id: string, @Body() body: BookReasonDto, @CurrentUser() user: User) {
    return this.booksService.decline(id, user.id, body.reason);
  }

  @Patch(':id/deprecate')
  @HasRoles(Roles.BOOK_APPROVE)
  @ApiOperation({ summary: 'Deprecate a book (hide from normal listings)' })
  @ApiResponse({ status: 200, description: 'Book deprecated successfully', type: Book })
  deprecate(@Param('id') id: string, @Body() body: BookReasonDto, @CurrentUser() user: User) {
    return this.booksService.deprecate(id, user.id, body.reason);
  }

  @Patch(':id')
  @HasRoles(Roles.BOOK_UPDATE)
  @UseInterceptors(FileInterceptor('file', ebookUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Update a book (Requires book:update role)' })
  @ApiResponse({ status: 200, description: 'Book updated successfully', type: Book })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        author: { type: 'string' },
        isbn: { type: 'string' },
        category: { type: 'string' },
        totalCopies: { type: 'number' },
        description: { type: 'string' },
        publishedDate: { type: 'string', format: 'date' },
        isEbook: { type: 'boolean' },
        requestReview: { type: 'boolean' },
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  update(@Param('id') id: string, @Body() updateBookDto: UpdateBookDto, @UploadedFile() file?: Express.Multer.File) {
    const { requestReview, ...bookData } = updateBookDto;
    return this.booksService.update(id, bookData, file, requestReview);
  }

  @Delete(':id')
  @HasRoles(Roles.BOOK_DELETE)
  @ApiOperation({ summary: 'Delete a book' })
  @ApiResponse({ status: 200, description: 'Book deleted successfully' })
  remove(@Param('id') id: string) {
    return this.booksService.remove(id);
  }
}
