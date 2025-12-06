import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { Loan, LoanStatus } from './entities/loan.entity';
import { Book } from '../books/entities/book.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class LoansService {
  constructor(
    @InjectRepository(Loan)
    private loansRepository: Repository<Loan>,
    @InjectRepository(Book)
    private booksRepository: Repository<Book>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async create(createLoanDto: CreateLoanDto): Promise<Loan> {
    const book = await this.booksRepository.findOne(createLoanDto.bookId);
    if (!book) {
      throw new NotFoundException(`Book with ID ${createLoanDto.bookId} not found`);
    }

    if (book.availableCopies <= 0) {
      throw new BadRequestException('No available copies of this book');
    }

    const user = await this.usersRepository.findOne(createLoanDto.userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${createLoanDto.userId} not found`);
    }

    // Decrease available copies
    book.availableCopies -= 1;
    await this.booksRepository.save(book);

    const loan = this.loansRepository.create(createLoanDto);
    return await this.loansRepository.save(loan);
  }

  async findAll(): Promise<Loan[]> {
    return await this.loansRepository.find({
      relations: ['book', 'user'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<Loan> {
    const loan = await this.loansRepository.findOne(id, {
      relations: ['book', 'user'],
    });
    if (!loan) {
      throw new NotFoundException(`Loan with ID ${id} not found`);
    }
    return loan;
  }

  async update(id: number, updateLoanDto: UpdateLoanDto): Promise<Loan> {
    const loan = await this.findOne(id);
    
    // If returning the book
    if (updateLoanDto.returnDate && loan.status === LoanStatus.ACTIVE) {
      const book = await this.booksRepository.findOne(loan.bookId);
      if (book) {
        book.availableCopies += 1;
        await this.booksRepository.save(book);
      }
      loan.status = LoanStatus.RETURNED;
    }

    Object.assign(loan, updateLoanDto);
    return await this.loansRepository.save(loan);
  }

  async remove(id: number): Promise<void> {
    const loan = await this.findOne(id);
    
    // If active loan, return the book
    if (loan.status === LoanStatus.ACTIVE) {
      const book = await this.booksRepository.findOne(loan.bookId);
      if (book) {
        book.availableCopies += 1;
        await this.booksRepository.save(book);
      }
    }
    
    await this.loansRepository.remove(loan);
  }

  async findByUser(userId: number): Promise<Loan[]> {
    return await this.loansRepository.find({
      where: { userId },
      relations: ['book', 'user'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByBook(bookId: number): Promise<Loan[]> {
    return await this.loansRepository.find({
      where: { bookId },
      relations: ['book', 'user'],
      order: { createdAt: 'DESC' },
    });
  }

  async getActiveLoans(): Promise<Loan[]> {
    return await this.loansRepository.find({
      where: { status: LoanStatus.ACTIVE },
      relations: ['book', 'user'],
      order: { dueDate: 'ASC' },
    });
  }
}

