import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
import { NotificationsGateway } from './notifications.gateway';
import { Roles } from '../roles/roles.constants';
import { toDateOnly } from '../common/date-only';

/** Socket events the frontend listens for. */
export const NOTIFICATION_EVENT = 'notification';
export const NOTIFICATIONS_READ_EVENT = 'notifications:read';

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

export interface NotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
}

interface BookRef {
  id?: string;
  title: string;
  author?: string;
}

interface LoanRef {
  userId: string;
  dueDate?: Date | string;
}

const formatDate = (value: Date | string | undefined): string => (value ? toDateOnly(value) : '');

/** Lengths of the notifications.title and .message columns. */
const TITLE_MAX = 200;
const MESSAGE_MAX = 500;

/** Book titles, authors and decline reasons are long free text; fit the columns. */
const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    private readonly gateway: NotificationsGateway,
  ) {}

  // ---------------------------------------------------------------------------
  // What happened -> who hears about it
  // ---------------------------------------------------------------------------

  /** A member asked to borrow a book: tell everyone who can approve loans. */
  loanRequested(borrower: { id: string; name: string }, book: BookRef): Promise<void> {
    return this.safely(() =>
      this.notifyRoleHolders(
        Roles.BOOK_LENDING_APPROVE,
        {
          type: NotificationType.LOAN_REQUESTED,
          title: 'New borrow request',
          message: `${borrower.name} asked to borrow "${book.title}".`,
          link: '/manager/lending',
        },
        borrower.id,
      ),
    );
  }

  loanApproved(loan: LoanRef, book: BookRef): Promise<void> {
    const due = formatDate(loan.dueDate);
    return this.safely(() =>
      this.notifyUsers([loan.userId], {
        type: NotificationType.LOAN_APPROVED,
        title: 'Borrow request approved',
        message: `Your request for "${book.title}" was approved.${due ? ` Please return it by ${due}.` : ''}`,
        link: '/my-page/book-lending',
      }),
    );
  }

  loanDeclined(loan: LoanRef, book: BookRef): Promise<void> {
    return this.safely(() =>
      this.notifyUsers([loan.userId], {
        type: NotificationType.LOAN_DECLINED,
        title: 'Borrow request declined',
        message: `Your request for "${book.title}" was declined.`,
        link: '/my-page/book-lending',
      }),
    );
  }

  loanDueSoon(loan: LoanRef, book: BookRef): Promise<void> {
    return this.safely(() =>
      this.notifyUsers([loan.userId], {
        type: NotificationType.LOAN_DUE_SOON,
        title: 'Book due soon',
        message: `"${book.title}" is due back on ${formatDate(loan.dueDate)}.`,
        link: '/my-page/book-lending',
      }),
    );
  }

  loanOverdue(loan: LoanRef, book: BookRef): Promise<void> {
    return this.safely(() =>
      this.notifyUsers([loan.userId], {
        type: NotificationType.LOAN_OVERDUE,
        title: 'Book overdue',
        message: `"${book.title}" was due back on ${formatDate(loan.dueDate)}. Please return it as soon as you can.`,
        link: '/my-page/book-lending',
      }),
    );
  }

  /** One alert per reminder run for staff, however many loans went overdue. */
  loansOverdueSummary(count: number): Promise<void> {
    if (count <= 0) {
      return Promise.resolve();
    }
    return this.safely(() =>
      this.notifyRoleHolders(Roles.BOOK_LENDING_APPROVE, {
        type: NotificationType.LOANS_OVERDUE_SUMMARY,
        title: 'Loans overdue',
        message: `${count} ${count === 1 ? 'loan has' : 'loans have'} just become overdue.`,
        link: '/manager/lending',
      }),
    );
  }

  /** A book entered review: tell everyone who can approve books. */
  bookAwaitingReview(book: BookRef, actorId?: string): Promise<void> {
    return this.safely(() =>
      this.notifyRoleHolders(
        Roles.BOOK_APPROVE,
        {
          type: NotificationType.BOOK_REVIEW_REQUESTED,
          title: 'Book awaiting review',
          message: `"${book.title}"${book.author ? ` by ${book.author}` : ''} needs approval.`,
          link: '/manager/books',
        },
        actorId,
      ),
    );
  }

  /**
   * Tells whoever submitted a book that it was approved. Nobody is told about
   * their own decision, and books with no recorded submitter send nothing.
   */
  bookApproved(book: BookRef & { submittedBy?: string | null }, reviewerId: string): Promise<void> {
    if (!book.submittedBy || book.submittedBy === reviewerId) {
      return Promise.resolve();
    }
    return this.safely(() =>
      this.notifyUsers([book.submittedBy as string], {
        type: NotificationType.BOOK_APPROVED,
        title: 'Book approved',
        message: `"${book.title}" was approved and is now in the catalogue.`,
        link: '/manager/books',
      }),
    );
  }

  bookDeclined(book: BookRef & { submittedBy?: string | null }, reviewerId: string, reason?: string | null): Promise<void> {
    if (!book.submittedBy || book.submittedBy === reviewerId) {
      return Promise.resolve();
    }
    return this.safely(() =>
      this.notifyUsers([book.submittedBy as string], {
        type: NotificationType.BOOK_DECLINED,
        title: 'Book declined',
        message: `"${book.title}" was declined.${reason ? ` Reason: ${reason}` : ''}`,
        link: '/manager/books',
      }),
    );
  }

  /** One summary for a CSV import instead of one alert per row. */
  booksAwaitingReview(count: number, actorId?: string): Promise<void> {
    if (count <= 0) {
      return Promise.resolve();
    }
    return this.safely(() =>
      this.notifyRoleHolders(
        Roles.BOOK_APPROVE,
        {
          type: NotificationType.BOOK_REVIEW_REQUESTED,
          title: 'Books awaiting review',
          message: `${count} imported ${count === 1 ? 'book needs' : 'books need'} approval.`,
          link: '/manager/books',
        },
        actorId,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Delivery
  // ---------------------------------------------------------------------------

  /** Stores one notification per user and pushes each to that user's sockets. */
  async notifyUsers(userIds: string[], input: NotificationInput): Promise<Notification[]> {
    const recipients = Array.from(new Set(userIds.filter(Boolean)));
    if (recipients.length === 0) {
      return [];
    }

    const saved = await this.notificationsRepository.save(
      recipients.map(userId =>
        this.notificationsRepository.create({
          userId,
          type: input.type,
          title: truncate(input.title, TITLE_MAX),
          message: truncate(input.message, MESSAGE_MAX),
          link: input.link || null,
          readAt: null,
        }),
      ),
    );

    saved.forEach(notification =>
      this.gateway.sendToUser(notification.userId, NOTIFICATION_EVENT, notification),
    );
    return saved;
  }

  async notifyRoleHolders(roleName: string, input: NotificationInput, excludeUserId?: string): Promise<Notification[]> {
    const userIds = await this.findUserIdsWithRole(roleName);
    return this.notifyUsers(userIds.filter(id => id !== excludeUserId), input);
  }

  /**
   * Active users holding a role directly or through any of their groups: the
   * same rule as User.hasRole(), done in SQL so it does not load every user.
   */
  async findUserIdsWithRole(roleName: string): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.notificationsRepository.query(
      `SELECT u.id AS id
         FROM users u
        WHERE u.blocked = 0
          AND (EXISTS (SELECT 1 FROM user_roles ur
                         JOIN roles r ON r.id = ur.roleId
                        WHERE ur.userId = u.id AND r.name = ?)
            OR EXISTS (SELECT 1 FROM user_groups ug
                         JOIN group_roles gr ON gr.groupId = ug.groupId
                         JOIN roles r ON r.id = gr.roleId
                        WHERE ug.userId = u.id AND r.name = ?))`,
      [roleName, roleName],
    );
    return rows.map(row => row.id);
  }

  /**
   * Signs a user's notification sockets out at once, for an account that has
   * just been blocked or deleted (otherwise they would last until the access
   * token expires).
   */
  disconnectUser(userId: string, reason: string): void {
    try {
      this.gateway.disconnectUser(userId, reason);
    } catch (error) {
      this.logger.error(`Could not disconnect notification sockets: ${error && error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  async listForUser(
    userId: string,
    limit: number = DEFAULT_LIST_LIMIT,
  ): Promise<{ items: Notification[]; unreadCount: number }> {
    const take = Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
    const [items, unreadCount] = await Promise.all([
      this.notificationsRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take,
      }),
      this.notificationsRepository.count({ where: { userId, readAt: IsNull() } }),
    ]);
    return { items, unreadCount };
  }

  /** Marks one of the user's own notifications read; other users' ids are ignored. */
  async markRead(userId: string, id: string): Promise<{ unreadCount: number }> {
    const result = await this.notificationsRepository.update({ id, userId, readAt: IsNull() }, { readAt: new Date() });
    return this.afterRead(userId, result.affected ? [id] : []);
  }

  async markAllRead(userId: string): Promise<{ unreadCount: number }> {
    await this.notificationsRepository.update({ userId, readAt: IsNull() }, { readAt: new Date() });
    return this.afterRead(userId, 'all');
  }

  /** Tells the user's other tabs, so their bells clear too. */
  private async afterRead(userId: string, ids: string[] | 'all'): Promise<{ unreadCount: number }> {
    const unreadCount = await this.notificationsRepository.count({ where: { userId, readAt: IsNull() } });
    if (ids === 'all' || ids.length > 0) {
      this.gateway.sendToUser(userId, NOTIFICATIONS_READ_EVENT, { ids, unreadCount });
    }
    return { unreadCount };
  }

  /**
   * A notification is a side effect of an action that has already succeeded
   * (and committed). Failing to deliver one is logged, never thrown back at
   * the user as if the loan or book change itself had failed.
   */
  private async safely(send: () => Promise<unknown>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error(`Could not send notification: ${error && error.message}`);
    }
  }
}
