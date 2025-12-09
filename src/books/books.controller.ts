import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { BooksService } from './books.service';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { Book } from './entities/book.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { Public } from '../auth/decorators/public.decorator';
import { diskStorage } from 'multer';
import { extname } from 'path';

@ApiTags('books')
@Controller('books')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.LIBRARIAN)
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads/ebooks',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      const allowedMimes = ['application/pdf', 'application/epub+zip', 'application/x-mobipocket-ebook'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only PDF, EPUB, and MOBI files are allowed.'), false);
      }
    },
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create a new book (Admin/Librarian only)' })
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
  create(@Body() createBookDto: CreateBookDto, @UploadedFile() file?: Express.Multer.File) {
    return this.booksService.create(createBookDto, file);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'Get all books (Public)' })
  @ApiResponse({ status: 200, description: 'List of all books', type: [Book] })
  findAll(@Query('search') search?: string) {
    if (search) {
      return this.booksService.search(search);
    }
    return this.booksService.findAll();
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get a book by ID (Public)' })
  @ApiResponse({ status: 200, description: 'Book found', type: Book })
  @ApiResponse({ status: 404, description: 'Book not found' })
  findOne(@Param('id') id: string) {
    return this.booksService.findOne(+id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.LIBRARIAN)
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads/ebooks',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      const allowedMimes = ['application/pdf', 'application/epub+zip', 'application/x-mobipocket-ebook'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only PDF, EPUB, and MOBI files are allowed.'), false);
      }
    },
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Update a book (Admin/Librarian only)' })
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
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  update(@Param('id') id: string, @Body() updateBookDto: UpdateBookDto, @UploadedFile() file?: Express.Multer.File) {
    return this.booksService.update(+id, updateBookDto, file);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.LIBRARIAN)
  @ApiOperation({ summary: 'Delete a book (Admin/Librarian only)' })
  @ApiResponse({ status: 200, description: 'Book deleted successfully' })
  remove(@Param('id') id: string) {
    return this.booksService.remove(+id);
  }
}

