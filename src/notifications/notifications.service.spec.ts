import { Logger } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { NotificationType } from './entities/notification.entity';
import {
  NotificationsService,
  NOTIFICATION_EVENT,
  NOTIFICATIONS_READ_EVENT,
  MAX_LIST_LIMIT,
} from './notifications.service';

function buildService(roleHolders: string[] = []) {
  let created = 0;
  const repository: any = {
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (rows: any[]) => rows.map(row => ({ ...row, id: `n-${++created}`, createdAt: new Date() }))),
    query: jest.fn(async () => roleHolders.map(id => ({ id }))),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const gateway: any = { sendToUser: jest.fn() };
  return { service: new NotificationsService(repository, gateway), repository, gateway };
}

const input = { type: NotificationType.LOAN_APPROVED, title: 'T', message: 'M', link: '/x' };

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('NotificationsService delivery', () => {
  it('stores one notification per recipient and pushes each to that user', async () => {
    const { service, repository, gateway } = buildService();

    const saved = await service.notifyUsers(['a', 'b', 'a'], input);

    expect(saved).toHaveLength(2);
    expect(repository.save.mock.calls[0][0]).toEqual([
      expect.objectContaining({ userId: 'a', readAt: null, link: '/x' }),
      expect.objectContaining({ userId: 'b', readAt: null, link: '/x' }),
    ]);
    expect(gateway.sendToUser).toHaveBeenCalledWith('a', NOTIFICATION_EVENT, expect.objectContaining({ id: 'n-1' }));
    expect(gateway.sendToUser).toHaveBeenCalledWith('b', NOTIFICATION_EVENT, expect.objectContaining({ id: 'n-2' }));
  });

  it('writes nothing when there is nobody to tell', async () => {
    const { service, repository, gateway } = buildService();

    expect(await service.notifyUsers([], input)).toEqual([]);
    expect(repository.save).not.toHaveBeenCalled();
    expect(gateway.sendToUser).not.toHaveBeenCalled();
  });

  it('looks role holders up through direct roles and groups, skipping blocked users', async () => {
    const { service, repository } = buildService(['a']);

    await service.findUserIdsWithRole('book:approve');

    const [sql, params] = repository.query.mock.calls[0];
    expect(sql).toContain('u.blocked = 0');
    expect(sql).toContain('user_roles');
    expect(sql).toContain('group_roles');
    expect(params).toEqual(['book:approve', 'book:approve']);
  });
});

describe('NotificationsService events', () => {
  it('tells lending approvers about a borrow request, but not the borrower', async () => {
    const { service, repository, gateway } = buildService(['approver', 'borrower']);

    await service.loanRequested({ id: 'borrower', name: 'Ana' }, { title: '三体' });

    expect(repository.query.mock.calls[0][1]).toEqual(['book_lending:approve', 'book_lending:approve']);
    expect(gateway.sendToUser).toHaveBeenCalledTimes(1);
    expect(gateway.sendToUser).toHaveBeenCalledWith(
      'approver',
      NOTIFICATION_EVENT,
      expect.objectContaining({
        type: NotificationType.LOAN_REQUESTED,
        message: 'Ana asked to borrow "三体".',
        link: '/manager/lending',
      }),
    );
  });

  it('tells the borrower an approved loan is due back', async () => {
    const { service, gateway } = buildService();

    await service.loanApproved({ userId: 'u1', dueDate: new Date('2026-10-11T00:00:00Z') }, { title: 'Dune' });

    expect(gateway.sendToUser).toHaveBeenCalledWith(
      'u1',
      NOTIFICATION_EVENT,
      expect.objectContaining({
        type: NotificationType.LOAN_APPROVED,
        message: 'Your request for "Dune" was approved. Please return it by 2026-10-11.',
        link: '/my-page/book-lending',
      }),
    );
  });

  it('tells the borrower a loan was declined', async () => {
    const { service, gateway } = buildService();

    await service.loanDeclined({ userId: 'u1' }, { title: 'Dune' });

    expect(gateway.sendToUser).toHaveBeenCalledWith(
      'u1',
      NOTIFICATION_EVENT,
      expect.objectContaining({ type: NotificationType.LOAN_DECLINED }),
    );
  });

  it('tells book approvers about a book awaiting review', async () => {
    const { service, repository, gateway } = buildService(['approver']);

    await service.bookAwaitingReview({ title: 'Dune', author: 'Herbert' }, 'creator');

    expect(repository.query.mock.calls[0][1]).toEqual(['book:approve', 'book:approve']);
    expect(gateway.sendToUser).toHaveBeenCalledWith(
      'approver',
      NOTIFICATION_EVENT,
      expect.objectContaining({ message: '"Dune" by Herbert needs approval.', link: '/manager/books' }),
    );
  });

  it('summarises an import, and says nothing when no book needs review', async () => {
    const { service, gateway } = buildService(['approver']);

    await service.booksAwaitingReview(0);
    expect(gateway.sendToUser).not.toHaveBeenCalled();

    await service.booksAwaitingReview(3);
    expect(gateway.sendToUser).toHaveBeenCalledWith(
      'approver',
      NOTIFICATION_EVENT,
      expect.objectContaining({ message: '3 imported books need approval.' }),
    );
  });

  it('never fails the action that triggered it', async () => {
    const { service, repository } = buildService();
    repository.save.mockRejectedValueOnce(new Error('database down'));

    await expect(service.loanApproved({ userId: 'u1' }, { title: 'Dune' })).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});

describe('NotificationsService reading', () => {
  it('lists the latest notifications with the unread count, capping the page size', async () => {
    const { service, repository } = buildService();
    repository.count.mockResolvedValueOnce(4);

    const result = await service.listForUser('u1', 5000);

    expect(result.unreadCount).toBe(4);
    expect(repository.find).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      order: { createdAt: 'DESC' },
      take: MAX_LIST_LIMIT,
    });
    expect(repository.count).toHaveBeenCalledWith({ where: { userId: 'u1', readAt: IsNull() } });
  });

  it('only marks the caller\'s own notification read, and syncs their other tabs', async () => {
    const { service, repository, gateway } = buildService();
    repository.count.mockResolvedValueOnce(2);

    const result = await service.markRead('u1', 'n-9');

    expect(repository.update).toHaveBeenCalledWith(
      { id: 'n-9', userId: 'u1', readAt: IsNull() },
      { readAt: expect.any(Date) },
    );
    expect(result).toEqual({ unreadCount: 2 });
    expect(gateway.sendToUser).toHaveBeenCalledWith('u1', NOTIFICATIONS_READ_EVENT, { ids: ['n-9'], unreadCount: 2 });
  });

  it('does not broadcast when nothing was marked (someone else\'s id, or already read)', async () => {
    const { service, repository, gateway } = buildService();
    repository.update.mockResolvedValueOnce({ affected: 0 });

    await service.markRead('u1', 'not-mine');

    expect(gateway.sendToUser).not.toHaveBeenCalled();
  });

  it('marks everything read', async () => {
    const { service, repository, gateway } = buildService();

    await service.markAllRead('u1');

    expect(repository.update).toHaveBeenCalledWith({ userId: 'u1', readAt: IsNull() }, { readAt: expect.any(Date) });
    expect(gateway.sendToUser).toHaveBeenCalledWith('u1', NOTIFICATIONS_READ_EVENT, { ids: 'all', unreadCount: 0 });
  });
});
