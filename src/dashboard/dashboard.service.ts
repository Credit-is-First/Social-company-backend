import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThanOrEqual } from 'typeorm';
import { Book, BookStatus } from '../books/entities/book.entity';
import { User } from '../users/entities/user.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';

/**
 * A loan as shown on the dashboard. Deliberately a flat summary rather than the
 * Loan entity: the entity drags the full Book and User rows along with it, and
 * this payload used to expose every borrower's password hash.
 */
export interface DashboardRecentLoan {
  id: string;
  bookTitle: string;
  userName: string;
  status: LoanStatus;
  createdAt: Date;
}

export interface DashboardLoansPerDay {
  date: string; // YYYY-MM-DD, local time
  loans: number;
}

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
  loansOverTime: DashboardLoansPerDay[];
  recentLoans: DashboardRecentLoan[];
}

const LOAN_HISTORY_DAYS = 7;
const RECENT_LOAN_COUNT = 5;

/** Local-time YYYY-MM-DD, so day buckets line up with what the user sees. */
function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toNumber(value: any): number {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? 0 : parsed;
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
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const historyStart = new Date(startOfToday);
    historyStart.setDate(historyStart.getDate() - (LOAN_HISTORY_DAYS - 1));

    const [
      totalBooks,
      totalUsers,
      totalLoans,
      activeLoans,
      pendingLoans,
      returnedLoans,
      overdueLoans,
      copyTotals,
      categoryRows,
      historyLoans,
      recentLoanEntities,
    ] = await Promise.all([
      this.booksRepository.count({ where: { status: BookStatus.APPROVED } }),
      this.usersRepository.count(),
      this.loansRepository.count(),
      this.loansRepository.count({ where: { status: LoanStatus.ACTIVE } }),
      this.loansRepository.count({ where: { status: LoanStatus.PENDING } }),
      this.loansRepository.count({ where: { status: LoanStatus.RETURNED } }),
      this.loansRepository.count({
        where: { status: LoanStatus.ACTIVE, dueDate: LessThan(startOfToday) },
      }),
      this.booksRepository
        .createQueryBuilder('book')
        .select('SUM(book.availableCopies)', 'available')
        .addSelect('SUM(book.totalCopies)', 'total')
        .where('book.status = :status', { status: BookStatus.APPROVED })
        .getRawOne(),
      this.booksRepository
        .createQueryBuilder('book')
        .select('book.category', 'category')
        .addSelect('COUNT(*)', 'count')
        .where('book.status = :status', { status: BookStatus.APPROVED })
        .groupBy('book.category')
        .getRawMany(),
      // Only the last 7 days of timestamps, so this stays bounded as the
      // loan table grows.
      this.loansRepository.find({
        where: { createdAt: MoreThanOrEqual(historyStart) },
        select: ['createdAt'],
      }),
      this.loansRepository.find({
        relations: ['book', 'user'],
        order: { createdAt: 'DESC' },
        take: RECENT_LOAN_COUNT,
      }),
    ]);

    const availableBooks = toNumber(copyTotals && copyTotals.available);
    const totalCopies = toNumber(copyTotals && copyTotals.total);

    const booksByCategory: { [key: string]: number } = {};
    categoryRows.forEach(row => {
      booksByCategory[row.category] = toNumber(row.count);
    });

    // Seed every day in the window so gaps render as zero rather than vanishing.
    const loansByDate: { [key: string]: number } = {};
    for (let offset = LOAN_HISTORY_DAYS - 1; offset >= 0; offset--) {
      const day = new Date(startOfToday);
      day.setDate(day.getDate() - offset);
      loansByDate[toLocalDateKey(day)] = 0;
    }
    historyLoans.forEach(loan => {
      const key = toLocalDateKey(new Date(loan.createdAt));
      if (Object.prototype.hasOwnProperty.call(loansByDate, key)) {
        loansByDate[key]++;
      }
    });

    const recentLoans: DashboardRecentLoan[] = recentLoanEntities.map(loan => ({
      id: loan.id,
      bookTitle: loan.book ? loan.book.title : 'Unknown Book',
      userName: loan.user ? loan.user.name : 'Unknown User',
      status: loan.status,
      createdAt: loan.createdAt,
    }));

    return {
      totalBooks,
      totalUsers,
      activeLoans,
      overdueLoans,
      pendingLoans,
      totalLoans,
      returnedLoans,
      availableBooks,
      borrowedBooks: Math.max(0, totalCopies - availableBooks),
      booksByCategory,
      loansOverTime: Object.keys(loansByDate).map(date => ({
        date,
        loans: loansByDate[date],
      })),
      recentLoans,
    };
  }
}
