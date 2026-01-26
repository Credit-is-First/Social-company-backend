import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Book, BookStatus } from '../books/entities/book.entity';
import { User } from '../users/entities/user.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';

export interface DashboardStats {
  totalBooks: number;
  totalUsers: number;
  activeLoans: number;
  overdueLoans: number;
  pendingLoans: number;
  totalLoans: number;
  returnedLoans: number;
  availableBooks: number;
  borrowedBooks: number;
  booksByCategory: { [key: string]: number };
  recentLoans: Loan[];
  allLoans: Loan[];
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Book)
    private booksRepository: Repository<Book>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Loan)
    private loansRepository: Repository<Loan>,
  ) {}

  async getStats(): Promise<DashboardStats> {
    // Get all counts using efficient queries
    const [
      totalBooks,
      totalUsers,
      allLoans,
      activeLoans,
      books,
    ] = await Promise.all([
      this.booksRepository.count({
        where: { status: BookStatus.APPROVED },
      }),
      this.usersRepository.count(),
      this.loansRepository.find({
        relations: ['book', 'user'],
        order: { createdAt: 'DESC' },
      }),
      this.loansRepository.find({
        where: { status: LoanStatus.ACTIVE },
        relations: ['book', 'user'],
        order: { dueDate: 'ASC' },
      }),
      this.booksRepository.find({
        where: { status: BookStatus.APPROVED },
        select: ['availableCopies', 'totalCopies', 'category'],
      }),
    ]);

    const totalLoans = allLoans.length;
    const activeLoansCount = activeLoans.length;

    // Calculate overdue loans (active loans with dueDate in the past)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueLoans = activeLoans.filter(loan => {
      const dueDate = new Date(loan.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate < today;
    }).length;

    // Calculate pending loans
    const pendingLoans = allLoans.filter(
      loan => loan.status === LoanStatus.PENDING
    ).length;

    // Calculate returned loans
    const returnedLoans = allLoans.filter(
      loan => loan.status === LoanStatus.RETURNED || loan.returnDate !== null
    ).length;

    // Calculate available and borrowed books
    const availableBooks = books.reduce(
      (sum, book) => sum + book.availableCopies,
      0
    );
    const borrowedBooks = books.reduce(
      (sum, book) => sum + (book.totalCopies - book.availableCopies),
      0
    );

    // Calculate books by category
    const booksByCategory: { [key: string]: number } = {};
    books.forEach(book => {
      booksByCategory[book.category] = (booksByCategory[book.category] || 0) + 1;
    });

    // Get recent loans (last 5, sorted by creation date)
    const recentLoans = allLoans
      .slice(0, 5);

    return {
      totalBooks,
      totalUsers,
      activeLoans: activeLoansCount,
      overdueLoans,
      pendingLoans,
      totalLoans,
      returnedLoans,
      availableBooks,
      borrowedBooks,
      booksByCategory,
      recentLoans,
      allLoans,
    };
  }
}
