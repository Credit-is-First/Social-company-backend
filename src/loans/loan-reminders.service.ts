import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Loan, LoanStatus } from './entities/loan.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { env } from '../config/env';

/** First pass shortly after startup, so a restart does not wait a full interval. */
export const STARTUP_DELAY_MS = 15 * 1000;

export interface ReminderRunResult {
  /** Active loans past their due date that were marked overdue. */
  markedOverdue: number;
  dueSoonReminders: number;
  overdueReminders: number;
  /** Overdue reminders that were the loan's first (the rest are repeats). */
  newlyOverdue: number;
}

type ReminderColumn = 'dueSoonNotifiedAt' | 'overdueNotifiedAt';

/**
 * Keeps loan statuses honest and reminds borrowers, on a timer.
 *
 * Each pass:
 * 1. marks active loans whose due date has passed as overdue (an overdue loan
 *    still holds its copy, so availability does not change);
 * 2. reminds borrowers once when a loan is due within LOAN_DUE_SOON_DAYS;
 * 3. reminds borrowers of overdue loans, then again every
 *    OVERDUE_REMINDER_REPEAT_DAYS until the book is returned, and sends
 *    lending staff one summary of the loans that have just become overdue.
 *
 * Dates are compared in the database (CURDATE()), the same clock the due dates
 * are stored against. Every reminder is claimed with a conditional UPDATE
 * before it is sent, so a loan returned mid-pass, or two passes overlapping,
 * never produces a duplicate or a reminder for a returned book.
 */
@Injectable()
export class LoanRemindersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LoanRemindersService.name);
  private startupTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<ReminderRunResult> | null = null;

  constructor(
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap(): void {
    const minutes = env.loanReminders.intervalMinutes;
    if (minutes <= 0) {
      this.logger.log('Loan reminders are off (LOAN_REMINDER_INTERVAL_MINUTES=0)');
      return;
    }
    // unref(): a pending reminder must never keep the process (or a test run) alive.
    this.startupTimer = setTimeout(() => this.runLogged(), STARTUP_DELAY_MS);
    this.startupTimer.unref();
    this.intervalTimer = setInterval(() => this.runLogged(), minutes * 60 * 1000);
    this.intervalTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = null;
    this.intervalTimer = null;
  }

  /** Runs one pass. A call made while a pass is running gets that pass's result. */
  run(): Promise<ReminderRunResult> {
    if (!this.inFlight) {
      const done = () => {
        this.inFlight = null;
      };
      this.inFlight = this.runOnce().then(
        result => {
          done();
          return result;
        },
        error => {
          done();
          throw error;
        },
      );
    }
    return this.inFlight;
  }

  private async runLogged(): Promise<void> {
    try {
      const result = await this.run();
      if (result.markedOverdue || result.dueSoonReminders || result.overdueReminders) {
        this.logger.log(
          `Marked ${result.markedOverdue} overdue; sent ${result.dueSoonReminders} due-soon and ` +
            `${result.overdueReminders} overdue reminders`,
        );
      }
    } catch (error) {
      this.logger.error(`Loan reminder pass failed: ${error && error.message}`);
    }
  }

  private async runOnce(): Promise<ReminderRunResult> {
    const markedOverdue = await this.markOverdue();
    const dueSoonReminders = await this.remindDueSoon();
    const { sent, newlyOverdue } = await this.remindOverdue();
    await this.notifications.loansOverdueSummary(newlyOverdue);
    return { markedOverdue, dueSoonReminders, overdueReminders: sent, newlyOverdue };
  }

  private async markOverdue(): Promise<number> {
    const result = await this.loansRepository
      .createQueryBuilder()
      .update(Loan)
      .set({ status: LoanStatus.OVERDUE })
      .where('status = :active', { active: LoanStatus.ACTIVE })
      .andWhere('dueDate < CURDATE()')
      .execute();
    return result.affected || 0;
  }

  private async remindDueSoon(): Promise<number> {
    const loans = await this.loansRepository
      .createQueryBuilder('loan')
      .leftJoinAndSelect('loan.book', 'book')
      .where('loan.status = :active', { active: LoanStatus.ACTIVE })
      .andWhere('loan.dueSoonNotifiedAt IS NULL')
      .andWhere('loan.dueDate >= CURDATE()')
      .andWhere('loan.dueDate <= DATE_ADD(CURDATE(), INTERVAL :days DAY)', { days: env.loanReminders.dueSoonDays })
      .getMany();

    let sent = 0;
    for (const loan of loans) {
      const claimed = await this.claim(loan.id, 'dueSoonNotifiedAt', 'dueSoonNotifiedAt IS NULL AND status = :active', {
        active: LoanStatus.ACTIVE,
      });
      if (claimed && loan.book) {
        await this.notifications.loanDueSoon(loan, loan.book);
        sent++;
      }
    }
    return sent;
  }

  private async remindOverdue(): Promise<{ sent: number; newlyOverdue: number }> {
    const repeatDays = env.loanReminders.overdueRepeatDays;
    const due = '(overdueNotifiedAt IS NULL OR overdueNotifiedAt <= DATE_SUB(NOW(), INTERVAL :days DAY))';
    const loans = await this.loansRepository
      .createQueryBuilder('loan')
      .leftJoinAndSelect('loan.book', 'book')
      .where('loan.status = :overdue', { overdue: LoanStatus.OVERDUE })
      .andWhere(due.replace(/overdueNotifiedAt/g, 'loan.overdueNotifiedAt'), { days: repeatDays })
      .getMany();

    let sent = 0;
    let newlyOverdue = 0;
    for (const loan of loans) {
      const claimed = await this.claim(loan.id, 'overdueNotifiedAt', `${due} AND status = :overdue`, {
        days: repeatDays,
        overdue: LoanStatus.OVERDUE,
      });
      if (claimed && loan.book) {
        await this.notifications.loanOverdue(loan, loan.book);
        sent++;
        if (!loan.overdueNotifiedAt) {
          newlyOverdue++;
        }
      }
    }
    return { sent, newlyOverdue };
  }

  /** Stamps a reminder column if the condition still holds; true when this pass won it. */
  private async claim(id: string, column: ReminderColumn, condition: string, params: object): Promise<boolean> {
    const result = await this.loansRepository
      .createQueryBuilder()
      .update(Loan)
      .set({ [column]: () => 'NOW()' } as any)
      .where('id = :id', { id })
      .andWhere(condition, params)
      .execute();
    return !!result.affected;
  }
}
