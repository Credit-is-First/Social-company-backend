import { Logger } from '@nestjs/common';
import { LoanRemindersService, STARTUP_DELAY_MS } from './loan-reminders.service';
import { Loan, LoanStatus } from './entities/loan.entity';
import { env } from '../config/env';

interface Query {
  kind: 'update' | 'select';
  set?: any;
  where: Array<[string, any]>;
}

/**
 * A fake repository whose query builders record what they were asked. Selects
 * are answered in order from `selects` (due-soon first, then overdue); a claim
 * UPDATE succeeds unless `lose` says another pass won it.
 */
function buildService(options: { selects?: Loan[][]; markAffected?: number; lose?: string[] } = {}) {
  const selects = (options.selects || [[], []]).slice();
  const queries: Query[] = [];

  const loansRepository: any = {
    createQueryBuilder: jest.fn(() => {
      const query: Query = { kind: 'select', where: [] };
      queries.push(query);
      const builder: any = {
        update: () => ((query.kind = 'update'), builder),
        set: (values: any) => ((query.set = values), builder),
        leftJoinAndSelect: () => builder,
        where: (sql: string, params?: any) => (query.where.push([sql, params]), builder),
        andWhere: (sql: string, params?: any) => (query.where.push([sql, params]), builder),
        getMany: async () => selects.shift() || [],
        execute: async () => {
          if (query.set && query.set.status) {
            return { affected: options.markAffected || 0 };
          }
          const id = query.where[0][1].id;
          return { affected: (options.lose || []).indexOf(id) === -1 ? 1 : 0 };
        },
      };
      return builder;
    }),
  };

  const notifications: any = {
    loanDueSoon: jest.fn(async () => undefined),
    loanOverdue: jest.fn(async () => undefined),
    loansOverdueSummary: jest.fn(async () => undefined),
  };

  return { service: new LoanRemindersService(loansRepository, notifications), notifications, queries };
}

const book = { id: 'b1', title: 'Dune' };
const loan = (id: string, overrides: Partial<Loan> = {}): Loan =>
  ({ id, userId: `user-${id}`, bookId: 'b1', book, dueDate: '2026-10-01', overdueNotifiedAt: null, ...overrides } as any);

const sql = (query: Query) => query.where.map(w => w[0]).join(' AND ');

describe('LoanRemindersService.run', () => {
  it('marks active loans past their due date as overdue', async () => {
    const { service, queries } = buildService({ markAffected: 3 });

    const result = await service.run();

    expect(result.markedOverdue).toBe(3);
    const mark = queries[0];
    expect(mark.kind).toBe('update');
    expect(mark.set).toEqual({ status: LoanStatus.OVERDUE });
    expect(mark.where[0]).toEqual(['status = :active', { active: LoanStatus.ACTIVE }]);
    expect(sql(mark)).toContain('dueDate < CURDATE()');
  });

  it('reminds each borrower once about a loan coming due', async () => {
    const { service, notifications, queries } = buildService({ selects: [[loan('l1'), loan('l2')], []] });

    const result = await service.run();

    expect(result.dueSoonReminders).toBe(2);
    expect(notifications.loanDueSoon).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1' }), book);
    const select = queries[1];
    expect(sql(select)).toContain('loan.dueSoonNotifiedAt IS NULL');
    expect(select.where).toContainEqual([
      'loan.dueDate <= DATE_ADD(CURDATE(), INTERVAL :days DAY)',
      { days: env.loanReminders.dueSoonDays },
    ]);
    // The claim re-checks the loan is still active and still unreminded.
    expect(sql(queries[2])).toContain('dueSoonNotifiedAt IS NULL AND status = :active');
  });

  it('skips a reminder another pass already claimed, or a loan returned meanwhile', async () => {
    const { service, notifications } = buildService({ selects: [[loan('l1'), loan('l2')], []], lose: ['l1'] });

    const result = await service.run();

    expect(result.dueSoonReminders).toBe(1);
    expect(notifications.loanDueSoon).toHaveBeenCalledTimes(1);
    expect(notifications.loanDueSoon).toHaveBeenCalledWith(expect.objectContaining({ id: 'l2' }), book);
  });

  it('reminds overdue borrowers, and tells staff only about the newly overdue', async () => {
    const repeat = loan('old', { overdueNotifiedAt: new Date('2026-09-01') });
    const { service, notifications, queries } = buildService({ selects: [[], [loan('new1'), loan('new2'), repeat]] });

    const result = await service.run();

    expect(result.overdueReminders).toBe(3);
    expect(result.newlyOverdue).toBe(2);
    expect(notifications.loanOverdue).toHaveBeenCalledTimes(3);
    expect(notifications.loansOverdueSummary).toHaveBeenCalledWith(2);
    const select = queries[2];
    expect(select.where[0]).toEqual(['loan.status = :overdue', { overdue: LoanStatus.OVERDUE }]);
    expect(select.where[1]).toEqual([
      '(loan.overdueNotifiedAt IS NULL OR loan.overdueNotifiedAt <= DATE_SUB(NOW(), INTERVAL :days DAY))',
      { days: env.loanReminders.overdueRepeatDays },
    ]);
    expect(sql(queries[3])).toContain('AND status = :overdue');
  });

  it('shares one pass between overlapping calls', async () => {
    const { service, queries } = buildService();

    const [a, b] = await Promise.all([service.run(), service.run()]);

    expect(a).toBe(b);
    expect(queries.filter(q => q.kind === 'update' && q.set && q.set.status)).toHaveLength(1);
  });

  it('can run again once a pass has finished, even a failed one', async () => {
    const { service, notifications } = buildService();
    notifications.loansOverdueSummary.mockRejectedValueOnce(new Error('boom'));

    await expect(service.run()).rejects.toThrow('boom');
    await expect(service.run()).resolves.toEqual(expect.objectContaining({ markedOverdue: 0 }));
  });
});

describe('LoanRemindersService timer', () => {
  const original = env.loanReminders.intervalMinutes;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    env.loanReminders.intervalMinutes = original;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('runs shortly after startup, then every interval, until shut down', () => {
    env.loanReminders.intervalMinutes = 60;
    const { service } = buildService();
    const run = jest.spyOn(service, 'run').mockResolvedValue({} as any);

    service.onApplicationBootstrap();
    jest.advanceTimersByTime(STARTUP_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    jest.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does nothing when switched off', () => {
    env.loanReminders.intervalMinutes = 0;
    const { service } = buildService();
    const run = jest.spyOn(service, 'run');

    service.onApplicationBootstrap();
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(run).not.toHaveBeenCalled();
  });

  it('logs a failed timed pass instead of crashing', async () => {
    env.loanReminders.intervalMinutes = 60;
    const { service } = buildService();
    jest.spyOn(service, 'run').mockRejectedValue(new Error('database down'));

    service.onApplicationBootstrap();
    jest.advanceTimersByTime(STARTUP_DELAY_MS);
    // Let the rejected pass settle through runLogged's await and catch.
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }

    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('database down'));
    service.onModuleDestroy();
  });
});
