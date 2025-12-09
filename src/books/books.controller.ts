import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { BooksService } from './books.service';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { Book } from './entities/book.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { HasRoles } from '../auth/decorators/roles.decorator';
import { Roles } from '../roles/roles.constants';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { memoryStorage } from 'multer';

@ApiTags('books')
@Controller('books')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Post()
  @HasRoles(Roles.BOOK_CREATE)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(), // Use memory storage to validate before saving to disk
    fileFilter: (req, file, cb) => {
      const allowedMimes = ['application/pdf', 'application/epub+zip', 'application/x-mobipocket-ebook'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new BadRequestException('Invalid file type. Only PDF, EPUB, and MOBI files are allowed.'), false);
      }
    },
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  }))
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
    return this.booksService.findOne(id);
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
  decline(@Param('id') id: string, @CurrentUser() user: User) {
    return this.booksService.decline(id, user.id);
  }

  @Patch(':id')
  @HasRoles(Roles.BOOK_UPDATE)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(), // Use memory storage to validate before saving to disk
    fileFilter: (req, file, cb) => {
      const allowedMimes = ['application/pdf', 'application/epub+zip', 'application/x-mobipocket-ebook'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new BadRequestException('Invalid file type. Only PDF, EPUB, and MOBI files are allowed.'), false);
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
    return this.booksService.update(id, updateBookDto, file);
  }

  @Delete(':id')
  @HasRoles(Roles.BOOK_DELETE)
  @ApiOperation({ summary: 'Delete a book' })
  @ApiResponse({ status: 200, description: 'Book deleted successfully' })
  remove(@Param('id') id: string) {
    return this.booksService.remove(id);
  }
}

