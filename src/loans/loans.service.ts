import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository, InjectConnection } from '@nestjs/typeorm';
import { Repository, Connection, EntityManager } from 'typeorm';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { Loan, LoanStatus } from './entities/loan.entity';
import { Book, BookStatus } from '../books/entities/book.entity';
import { User } from '../users/entities/user.entity';

const DEFAULT_LOAN_DAYS = 14;

/**
 * A loan holds one physical copy for exactly as long as it is out with the
 * borrower. availableCopies is adjusted on every transition across this
 * boundary and nowhere else, which is what keeps the count consistent.
 */
function holdsCopy(status: LoanStatus): boolean {
  return status === LoanStatus.ACTIVE || status === LoanStatus.OVERDUE;
}

@Injectable()
export class LoansService {
  constructor(
    @InjectRepository(Loan)
    private loansRepository: Repository<Loan>,
    @InjectRepository(Book)
    private booksRepository: Repository<Book>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectConnection()
    private connection: Connection,
  ) {}

  // ---------------------------------------------------------------------------
  // Copy accounting
  // ---------------------------------------------------------------------------

  /**
   * Moves availableCopies by `delta` under a row lock, so two concurrent
   * borrows of the last copy cannot both succeed.
   */
  private async adjustAvailableCopies(
    manager: EntityManager,
    bookId: string,
    delta: number,
  ): Promise<Book> {
    const book = await manager.findOne(Book, bookId, {
      lock: { mode: 'pessimistic_write' },
    });
    if (!book) {
      throw new NotFoundException(`Book with ID ${bookId} not found`);
    }

    const next = book.availableCopies + delta;
    if (next < 0) {
      throw new BadRequestException('No available copies of this book');
    }

    book.availableCopies = Math.min(next, book.totalCopies);
    await manager.save(Book, book);
    return book;
  }

  private async assertBorrowable(manager: EntityManager, bookId: string): Promise<Book> {
    const book = await manager.findOne(Book, bookId);
    if (!book) {
      throw new NotFoundException(`Book with ID ${bookId} not found`);
    }
    if (book.status !== BookStatus.APPROVED) {
      throw new BadRequestException('This book is not approved for lending');
    }
    return book;
  }

  private async assertNoOpenLoan(manager: EntityManager, userId: string, bookId: string): Promise<void> {
    const existingLoan = await manager.findOne(Loan, {
      where: [
        { userId, bookId, status: LoanStatus.ACTIVE },
        { userId, bookId, status: LoanStatus.OVERDUE },
        { userId, bookId, status: LoanStatus.PENDING },
      ],
    });
    if (existingLoan) {
      throw new BadRequestException('There is already a pending or active loan for this book and user');
    }
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Staff-initiated loan: the book is handed over immediately, so it is created
   * ACTIVE and takes its copy at once. (It used to be created PENDING while
   * still decrementing, so approving it decremented a second time.)
   */
  async create(createLoanDto: CreateLoanDto): Promise<Loan> {
    const borrowDate = new Date(createLoanDto.borrowDate);
    const dueDate = new Date(createLoanDto.dueDate);
    if (dueDate < borrowDate) {
      throw new BadRequestException('Due date cannot be earlier than the borrow date');
    }

    return await this.connection.transaction(async manager => {
      await this.assertBorrowable(manager, createLoanDto.bookId);

      const user = await manager.findOne(User, createLoanDto.userId);
      if (!user) {
        throw new NotFoundException(`User with ID ${createLoanDto.userId} not found`);
      }

      await this.assertNoOpenLoan(manager, createLoanDto.userId, createLoanDto.bookId);
      await this.adjustAvailableCopies(manager, createLoanDto.bookId, -1);

      const loan = manager.create(Loan, {
        bookId: createLoanDto.bookId,
        userId: createLoanDto.userId,
        borrowDate,
        dueDate,
        status: LoanStatus.ACTIVE,
      });
      return await manager.save(Loan, loan);
    });
  }

  /** Borrower-initiated request: no copy is taken until staff approve it. */
  async createForUser(userId: string, bookId: string): Promise<Loan> {
    if (!bookId) {
      throw new BadRequestException('bookId is required');
    }

    return await this.connection.transaction(async manager => {
      const book = await this.assertBorrowable(manager, bookId);
      if (book.availableCopies <= 0) {
        throw new BadRequestException('No available copies of this book');
      }

      const user = await manager.findOne(User, userId);
      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }

      // Members must complete their profile before borrowing. Staff-issued
      // loans (create()) deliberately skip this, so the desk can still lend to
      // someone who is filling their details in at the counter.
      const missing = user.missingProfileFields;
      if (missing.length > 0) {
        throw new ForbiddenException(
          `Complete your profile before borrowing. Still needed: ${missing.join(', ')}.`,
        );
      }

      await this.assertNoOpenLoan(manager, userId, bookId);

      const borrowDate = new Date();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + DEFAULT_LOAN_DAYS);

      const loan = manager.create(Loan, {
        bookId,
        userId,
        borrowDate,
        dueDate,
        status: LoanStatus.PENDING,
      });
      return await manager.save(Loan, loan);
    });
  }

  async approve(id: string): Promise<Loan> {
    return await this.connection.transaction(async manager => {
      const loan = await this.findOneWithin(manager, id);

      if (loan.status !== LoanStatus.PENDING) {
        throw new BadRequestException('Only pending loans can be approved');
      }

      await this.assertBorrowable(manager, loan.bookId);
      await this.adjustAvailableCopies(manager, loan.bookId, -1);

      loan.status = LoanStatus.ACTIVE;
      return await manager.save(Loan, loan);
    });
  }

  async decline(id: string): Promise<Loan> {
    return await this.connection.transaction(async manager => {
      const loan = await this.findOneWithin(manager, id);

      if (loan.status !== LoanStatus.PENDING) {
        throw new BadRequestException('Only pending loans can be declined');
      }

      loan.status = LoanStatus.DECLINED;
      return await manager.save(Loan, loan);
    });
  }

  /** Marks an outstanding loan as returned and puts the copy back. */
  async returnLoan(id: string, returnDate?: Date): Promise<Loan> {
    return await this.connection.transaction(async manager => {
      const loan = await this.findOneWithin(manager, id);

      if (!holdsCopy(loan.status)) {
        throw new BadRequestException('Only active loans can be returned');
      }

      await this.adjustAvailableCopies(manager, loan.bookId, 1);

      loan.status = LoanStatus.RETURNED;
      loan.returnDate = returnDate || new Date();
      return await manager.save(Loan, loan);
    });
  }

  async update(id: string, updateLoanDto: UpdateLoanDto): Promise<Loan> {
    return await this.connection.transaction(async manager => {
      const loan = await this.findOneWithin(manager, id);

      const previousStatus = loan.status;
      let nextStatus = updateLoanDto.status || previousStatus;

      // Recording a return date on an outstanding loan implies a return.
      if (updateLoanDto.returnDate && holdsCopy(previousStatus) && !updateLoanDto.status) {
        nextStatus = LoanStatus.RETURNED;
      }

      if (!holdsCopy(previousStatus) && holdsCopy(nextStatus)) {
        await this.adjustAvailableCopies(manager, loan.bookId, -1);
      } else if (holdsCopy(previousStatus) && !holdsCopy(nextStatus)) {
        await this.adjustAvailableCopies(manager, loan.bookId, 1);
      }

      if (updateLoanDto.returnDate !== undefined) {
        loan.returnDate = new Date(updateLoanDto.returnDate);
      } else if (nextStatus === LoanStatus.RETURNED && !loan.returnDate) {
        loan.returnDate = new Date();
      }

      loan.status = nextStatus;
      return await manager.save(Loan, loan);
    });
  }

  async remove(id: string): Promise<void> {
    await this.connection.transaction(async manager => {
      const loan = await this.findOneWithin(manager, id);

      // Deleting an outstanding loan releases its copy; deleting a pending or
      // returned one must not, because it never held (or already released) one.
      if (holdsCopy(loan.status)) {
        await this.adjustAvailableCopies(manager, loan.bookId, 1);
      }

      await manager.remove(Loan, loan);
    });
  }

  async cancelUserLoan(userId: string, loanId: string): Promise<void> {
    await this.connection.transaction(async manager => {
      const loan = await this.findOneWithin(manager, loanId);

      // Verify that the loan belongs to the user
      if (loan.userId !== userId) {
        throw new ForbiddenException('You can only cancel your own loans');
      }

      // A member can withdraw a request, but once the book is in their hands
      // the loan is the only record of where the copy is: it ends by being
      // returned at the desk, never by being deleted.
      if (loan.status !== LoanStatus.PENDING) {
        throw new BadRequestException('Only pending requests can be cancelled. Return the book to end an active loan.');
      }

      await manager.remove(Loan, loan);
    });
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Reads a loan under a row lock. Every status transition goes through here,
   * so two concurrent transitions of the same loan (a double-clicked Approve,
   * a return racing a cancel) serialise, and the second one sees the status
   * the first one wrote instead of both passing their check.
   */
  private async findOneWithin(manager: EntityManager, id: string): Promise<Loan> {
    const loan = await manager.findOne(Loan, id, {
      lock: { mode: 'pessimistic_write' },
    });
    if (!loan) {
      throw new NotFoundException(`Loan with ID ${id} not found`);
    }
    return loan;
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

  async getPendingLoans(): Promise<Loan[]> {
    return await this.loansRepository.find({
      where: { status: LoanStatus.PENDING },
      relations: ['book', 'user'],
      order: { createdAt: 'DESC' },
    });
  }
}
