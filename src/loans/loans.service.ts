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
    const book = await this.booksRepository.findOne({ where: { id: createLoanDto.bookId } });
    if (!book) {
      throw new NotFoundException(`Book with ID ${createLoanDto.bookId} not found`);
    }

    if (book.availableCopies <= 0) {
      throw new BadRequestException('No available copies of this book');
    }

    const user = await this.usersRepository.findOne({ where: { id: createLoanDto.userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${createLoanDto.userId} not found`);
    }

    // Decrease available copies
    book.availableCopies -= 1;
    await this.booksRepository.save(book);

    const loan = this.loansRepository.create(createLoanDto);
    return await this.loansRepository.save(loan);
  }

  async createForUser(userId: string, bookId: string): Promise<Loan> {
    const book = await this.booksRepository.findOne({ where: { id: bookId } });
    if (!book) {
      throw new NotFoundException(`Book with ID ${bookId} not found`);
    }

    if (!book.isApproved) {
      throw new BadRequestException('This book is not approved yet');
    }

    if (book.availableCopies <= 0) {
      throw new BadRequestException('No available copies of this book');
    }

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Check if user already has a pending or active loan for this book
    const existingLoan = await this.loansRepository.findOne({
      where: [
        { userId, bookId, status: LoanStatus.ACTIVE },
        { userId, bookId, status: LoanStatus.PENDING },
      ],
    });
    if (existingLoan) {
      throw new BadRequestException('You already have a pending or active loan for this book');
    }

    const today = new Date();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14); // 14 days loan period

    // Create loan with pending status (needs approval)
    const loan = this.loansRepository.create({
      bookId,
      userId,
      borrowDate: today,
      dueDate,
      status: LoanStatus.PENDING,
    });
    return await this.loansRepository.save(loan);
  }

  async approve(id: string): Promise<Loan> {
    const loan = await this.findOne(id);
    
    if (loan.status !== LoanStatus.PENDING) {
      throw new BadRequestException('Only pending loans can be approved');
    }

    const book = await this.booksRepository.findOne({ where: { id: loan.bookId } });
    if (!book) {
      throw new NotFoundException(`Book with ID ${loan.bookId} not found`);
    }

    if (book.availableCopies <= 0) {
      throw new BadRequestException('No available copies of this book');
    }

    // Decrease available copies
    book.availableCopies -= 1;
    await this.booksRepository.save(book);

    loan.status = LoanStatus.ACTIVE;
    return await this.loansRepository.save(loan);
  }

  async decline(id: string): Promise<Loan> {
    const loan = await this.findOne(id);
    
    if (loan.status !== LoanStatus.PENDING) {
      throw new BadRequestException('Only pending loans can be declined');
    }

    loan.status = LoanStatus.DECLINED;
    return await this.loansRepository.save(loan);
  }

  async findAll(): Promise<Loan[]> {
    return await this.loansRepository.find({
      relations: ['book', 'user'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Loan> {
    const loan = await this.loansRepository.findOne({
      where: { id },
      relations: ['book', 'user'],
    });
    if (!loan) {
      throw new NotFoundException(`Loan with ID ${id} not found`);
    }
    return loan;
  }

  async update(id: string, updateLoanDto: UpdateLoanDto): Promise<Loan> {
    const loan = await this.findOne(id);
    
    // If returning the book
    if (updateLoanDto.returnDate && loan.status === LoanStatus.ACTIVE) {
      const book = await this.booksRepository.findOne({ where: { id: loan.bookId } });
      if (book) {
        book.availableCopies += 1;
        await this.booksRepository.save(book);
      }
      loan.status = LoanStatus.RETURNED;
    }

    Object.assign(loan, updateLoanDto);
    return await this.loansRepository.save(loan);
  }

  async remove(id: string): Promise<void> {
    const loan = await this.findOne(id);
    
    // If active loan, return the book
    if (loan.status === LoanStatus.ACTIVE) {
      const book = await this.booksRepository.findOne({ where: { id: loan.bookId } });
      if (book) {
        book.availableCopies += 1;
        await this.booksRepository.save(book);
      }
    }
    
    await this.loansRepository.remove(loan);
  }

  async findByUser(userId: string): Promise<Loan[]> {
    return await this.loansRepository.find({
      where: { userId },
      relations: ['book', 'user'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByBook(bookId: string): Promise<Loan[]> {
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

  async cancelUserLoan(userId: string, loanId: string): Promise<void> {
    const loan = await this.findOne(loanId);
    
    // Verify that the loan belongs to the user
    if (loan.userId !== userId) {
      throw new BadRequestException('You can only cancel your own loans');
    }

    // Only allow canceling pending or active loans
    if (loan.status !== LoanStatus.PENDING && loan.status !== LoanStatus.ACTIVE) {
      throw new BadRequestException('You can only cancel pending or active loans');
    }

    // If active loan, return the book
    if (loan.status === LoanStatus.ACTIVE) {
      const book = await this.booksRepository.findOne({ where: { id: loan.bookId } });
      if (book) {
        book.availableCopies += 1;
        await this.booksRepository.save(book);
      }
    }
    
    await this.loansRepository.remove(loan);
  }
}

