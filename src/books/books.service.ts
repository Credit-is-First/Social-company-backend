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

  async create(createBookDto: CreateBookDto): Promise<Book> {
    const book = this.booksRepository.create({
      ...createBookDto,
      availableCopies: createBookDto.totalCopies,
    });
    return await this.booksRepository.save(book);
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

  async update(id: number, updateBookDto: UpdateBookDto): Promise<Book> {
    const book = await this.findOne(id);
    
    if (updateBookDto.totalCopies !== undefined) {
      const difference = updateBookDto.totalCopies - book.totalCopies;
      book.availableCopies = Math.max(0, book.availableCopies + difference);
    }

    Object.assign(book, updateBookDto);
    return await this.booksRepository.save(book);
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

