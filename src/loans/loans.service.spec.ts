import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LoansService } from './loans.service';
import { Loan, LoanStatus } from './entities/loan.entity';
import { Book, BookStatus } from '../books/entities/book.entity';
import { User, Gender } from '../users/entities/user.entity';
import { addDays, todayDateOnly } from '../common/date-only';

/**
 * These tests pin the invariant the whole lending flow rests on:
 * availableCopies moves exactly once when a loan starts holding a copy and
 * exactly once when it stops, and never at any other time.
 */

const BOOK_ID = 'book-1';
const USER_ID = 'user-1';

interface World {
  books: { [id: string]: Book };
  users: { [id: string]: User };
  loans: { [id: string]: Loan };
}

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: BOOK_ID,
    title: 'Test Book',
    status: BookStatus.APPROVED,
    totalCopies: 2,
    availableCopies: 2,
    ...overrides,
  } as Book;
}

/**
 * A real User instance, not a literal: borrowing consults the
 * missingProfileFields getter, which only exists on the prototype.
 */
function makeUser(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: USER_ID,
    name: 'Borrower',
    phone: '5551234567',
    address: '4 Library Lane',
    dateOfBirth: new Date('1990-05-21'),
    gender: Gender.OTHER,
    occupation: 'Tester',
    photoPath: '/uploads/photos/user-1.png',
  }, overrides);
}

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'loan-1',
    bookId: BOOK_ID,
    userId: USER_ID,
    status: LoanStatus.PENDING,
    borrowDate: '2026-01-01',
    dueDate: '2026-01-15',
    returnDate: null,
    ...overrides,
  } as Loan;
}

function buildService(world: World) {
  let created = 0;

  const manager: any = {
    findOne: jest.fn(async (entity: any, second?: any) => {
      if (entity === Book) return world.books[second] || null;
      if (entity === User) return world.users[second] || null;
      if (entity === Loan) {
        if (typeof second === 'string') return world.loans[second] || null;
        // The open-loan lookup passes { where: [ {...}, ... ] }
        const clauses = (second && second.where) || [];
        return (
          Object.keys(world.loans)
            .map(id => world.loans[id])
            .find(loan =>
              clauses.some(
                (clause: any) =>
                  clause.userId === loan.userId &&
                  clause.bookId === loan.bookId &&
                  clause.status === loan.status,
              ),
            ) || null
        );
      }
      return null;
    }),
    save: jest.fn(async (entity: any, value: any) => {
      if (entity === Book) world.books[value.id] = value;
      if (entity === Loan) {
        if (!value.id) value.id = `loan-new-${++created}`;
        world.loans[value.id] = value;
      }
      return value;
    }),
    create: jest.fn((entity: any, data: any) => ({ ...data })),
    remove: jest.fn(async (entity: any, value: any) => {
      if (entity === Loan) delete world.loans[value.id];
      return value;
    }),
  };

  const loansRepository: any = {
    findOne: jest.fn(async (options: any) => world.loans[options.where.id] || null),
    save: jest.fn(async (value: any) => {
      world.loans[value.id] = value;
      return value;
    }),
    find: jest.fn(async () => []),
  };

  const connection: any = {
    transaction: jest.fn(async (cb: any) => cb(manager)),
  };

  const notifications: any = {
    loanRequested: jest.fn(async () => undefined),
    loanApproved: jest.fn(async () => undefined),
    loanDeclined: jest.fn(async () => undefined),
    bookAwaitingReview: jest.fn(async () => undefined),
    booksAwaitingReview: jest.fn(async () => undefined),
  };

  const service = new LoansService(loansRepository, {} as any, {} as any, connection, notifications);
  return { service, manager, loansRepository, connection, notifications };
}

function freshWorld(bookOverrides: Partial<Book> = {}, userOverrides: Partial<User> = {}): World {
  return {
    books: { [BOOK_ID]: makeBook(bookOverrides) },
    users: { [USER_ID]: makeUser(userOverrides) },
    loans: {},
  };
}

describe('LoansService copy accounting', () => {
  describe('createForUser (borrower request)', () => {
    it('creates a pending loan without reserving a copy', async () => {
      const world = freshWorld();
      const { service } = buildService(world);

      const loan = await service.createForUser(USER_ID, BOOK_ID);

      expect(loan.status).toBe(LoanStatus.PENDING);
      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('refuses a book that is not approved', async () => {
      const world = freshWorld({ status: BookStatus.REVIEWING });
      const { service } = buildService(world);

      await expect(service.createForUser(USER_ID, BOOK_ID)).rejects.toBeInstanceOf(BadRequestException);
      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('refuses when no copies are available', async () => {
      const world = freshWorld({ availableCopies: 0 });
      const { service } = buildService(world);

      await expect(service.createForUser(USER_ID, BOOK_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a second open request for the same book', async () => {
      const world = freshWorld();
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.PENDING });
      const { service } = buildService(world);

      await expect(service.createForUser(USER_ID, BOOK_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an unknown book', async () => {
      const world = freshWorld();
      const { service } = buildService(world);

      await expect(service.createForUser(USER_ID, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a member whose profile is incomplete', async () => {
      const world = freshWorld({}, { photoPath: null, occupation: null });
      const { service } = buildService(world);

      await expect(service.createForUser(USER_ID, BOOK_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('names the outstanding fields when refusing', async () => {
      const world = freshWorld({}, { photoPath: null });
      const { service } = buildService(world);

      await expect(service.createForUser(USER_ID, BOOK_ID)).rejects.toThrow(/Profile photo/);
    });
  });

  describe('approve', () => {
    it('reserves exactly one copy', async () => {
      const world = freshWorld();
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.PENDING });
      const { service } = buildService(world);

      const loan = await service.approve('loan-1');

      expect(loan.status).toBe(LoanStatus.ACTIVE);
      expect(world.books[BOOK_ID].availableCopies).toBe(1);
    });

    it('does not double-decrement when approving twice', async () => {
      const world = freshWorld();
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.PENDING });
      const { service } = buildService(world);

      await service.approve('loan-1');
      await expect(service.approve('loan-1')).rejects.toBeInstanceOf(BadRequestException);

      expect(world.books[BOOK_ID].availableCopies).toBe(1);
    });

    it('reads the loan under a row lock so concurrent transitions serialise', async () => {
      const world = freshWorld();
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.PENDING });
      const { service, manager } = buildService(world);

      await service.approve('loan-1');

      expect(manager.findOne).toHaveBeenCalledWith(Loan, 'loan-1', {
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('refuses when the last copy went while the request was pending', async () => {
      const world = freshWorld({ availableCopies: 0 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.PENDING });
      const { service } = buildService(world);

      await expect(service.approve('loan-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(world.books[BOOK_ID].availableCopies).toBe(0);
    });
  });

  describe('returnLoan', () => {
    it('releases the copy and records a return date', async () => {
      const world = freshWorld({ availableCopies: 1 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.ACTIVE });
      const { service } = buildService(world);

      const loan = await service.returnLoan('loan-1');

      expect(loan.status).toBe(LoanStatus.RETURNED);
      expect(loan.returnDate).toBe(todayDateOnly());
      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('releases the copy for an overdue loan too', async () => {
      const world = freshWorld({ availableCopies: 1 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.OVERDUE });
      const { service } = buildService(world);

      await service.returnLoan('loan-1');

      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('refuses to return a pending request', async () => {
      const world = freshWorld();
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.PENDING });
      const { service } = buildService(world);

      await expect(service.returnLoan('loan-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('never pushes availableCopies above totalCopies', async () => {
      const world = freshWorld({ availableCopies: 2, totalCopies: 2 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.ACTIVE });
      const { service } = buildService(world);

      await service.returnLoan('loan-1');

      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });
  });

  describe('create (staff issues a loan directly)', () => {
    // Staff issuance deliberately skips the profile gate, so the desk can lend
    // to someone who is still filling their details in at the counter.
    it('issues to a member with an incomplete profile', async () => {
      const world = freshWorld({}, { photoPath: null, occupation: null });
      const { service } = buildService(world);

      const loan = await service.create({
        bookId: BOOK_ID,
        userId: USER_ID,
        borrowDate: '2026-01-01',
        dueDate: '2026-01-15',
      });

      expect(loan.status).toBe(LoanStatus.ACTIVE);
      expect(world.books[BOOK_ID].availableCopies).toBe(1);
    });

    it('issues an active loan and takes a copy', async () => {
      const world = freshWorld();
      const { service } = buildService(world);

      const loan = await service.create({
        bookId: BOOK_ID,
        userId: USER_ID,
        borrowDate: '2026-01-01',
        dueDate: '2026-01-15',
      });

      expect(loan.status).toBe(LoanStatus.ACTIVE);
      expect(world.books[BOOK_ID].availableCopies).toBe(1);
    });

    it('rejects a due date before the borrow date', async () => {
      const world = freshWorld();
      const { service } = buildService(world);

      await expect(
        service.create({
          bookId: BOOK_ID,
          userId: USER_ID,
          borrowDate: '2026-02-01',
          dueDate: '2026-01-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('rejects an unapproved book', async () => {
      const world = freshWorld({ status: BookStatus.DECLINED });
      const { service } = buildService(world);

      await expect(
        service.create({
          bookId: BOOK_ID,
          userId: USER_ID,
          borrowDate: '2026-01-01',
          dueDate: '2026-01-15',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('treats a return date on an active loan as a return', async () => {
      const world = freshWorld({ availableCopies: 1 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.ACTIVE });
      const { service } = buildService(world);

      const loan = await service.update('loan-1', { returnDate: '2026-01-10' });

      expect(loan.status).toBe(LoanStatus.RETURNED);
      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('releases the copy when the status leaves active without a return date', async () => {
      const world = freshWorld({ availableCopies: 1 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.ACTIVE });
      const { service } = buildService(world);

      await service.update('loan-1', { status: LoanStatus.RETURNED });

      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('takes a copy when a pending loan is switched to active', async () => {
      const world = freshWorld();
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.PENDING });
      const { service } = buildService(world);

      await service.update('loan-1', { status: LoanStatus.ACTIVE });

      expect(world.books[BOOK_ID].availableCopies).toBe(1);
    });

    it('does not move the count when the status is unchanged', async () => {
      const world = freshWorld({ availableCopies: 1 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.ACTIVE });
      const { service } = buildService(world);

      await service.update('loan-1', { status: LoanStatus.ACTIVE });

      expect(world.books[BOOK_ID].availableCopies).toBe(1);
    });
  });

  describe('decline', () => {
    it('runs inside a transaction and reads the loan under a lock', async () => {
      const world = freshWorld();
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.PENDING });
      const { service, manager, connection } = buildService(world);

      const loan = await service.decline('loan-1');

      expect(loan.status).toBe(LoanStatus.DECLINED);
      expect(connection.transaction).toHaveBeenCalled();
      expect(manager.findOne).toHaveBeenCalledWith(Loan, 'loan-1', {
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('refuses a loan that was already approved', async () => {
      const world = freshWorld({ availableCopies: 1 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.ACTIVE });
      const { service } = buildService(world);

      await expect(service.decline('loan-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(world.loans['loan-1'].status).toBe(LoanStatus.ACTIVE);
      expect(world.books[BOOK_ID].availableCopies).toBe(1);
    });
  });

  describe('remove and cancel', () => {
    it('releases the copy when deleting an active loan', async () => {
      const world = freshWorld({ availableCopies: 1 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.ACTIVE });
      const { service } = buildService(world);

      await service.remove('loan-1');

      expect(world.books[BOOK_ID].availableCopies).toBe(2);
      expect(world.loans['loan-1']).toBeUndefined();
    });

    it('does not invent a copy when deleting a pending loan', async () => {
      const world = freshWorld();
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.PENDING });
      const { service } = buildService(world);

      await service.remove('loan-1');

      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('does not invent a copy when deleting a returned loan', async () => {
      const world = freshWorld();
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.RETURNED });
      const { service } = buildService(world);

      await service.remove('loan-1');

      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('refuses to cancel someone else\'s loan', async () => {
      const world = freshWorld({ availableCopies: 1 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.ACTIVE });
      const { service } = buildService(world);

      await expect(service.cancelUserLoan('someone-else', 'loan-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(world.books[BOOK_ID].availableCopies).toBe(1);
    });

    it('lets the owner withdraw a pending request', async () => {
      const world = freshWorld();
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.PENDING });
      const { service } = buildService(world);

      await service.cancelUserLoan(USER_ID, 'loan-1');

      expect(world.loans['loan-1']).toBeUndefined();
      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });

    it('refuses to let the owner cancel an active loan', async () => {
      const world = freshWorld({ availableCopies: 1 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.ACTIVE });
      const { service } = buildService(world);

      await expect(service.cancelUserLoan(USER_ID, 'loan-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(world.loans['loan-1']).toBeDefined();
      expect(world.books[BOOK_ID].availableCopies).toBe(1);
    });

    it('refuses to let the owner cancel an overdue loan', async () => {
      const world = freshWorld({ availableCopies: 1 });
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.OVERDUE });
      const { service } = buildService(world);

      await expect(service.cancelUserLoan(USER_ID, 'loan-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(world.books[BOOK_ID].availableCopies).toBe(1);
    });

    it('refuses to cancel an already returned loan', async () => {
      const world = freshWorld();
      world.loans['loan-1'] = makeLoan({ status: LoanStatus.RETURNED });
      const { service } = buildService(world);

      await expect(service.cancelUserLoan(USER_ID, 'loan-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('full lifecycle', () => {
    it('returns the count to its starting value', async () => {
      const world = freshWorld();
      const { service } = buildService(world);

      const request = await service.createForUser(USER_ID, BOOK_ID);
      expect(world.books[BOOK_ID].availableCopies).toBe(2);

      await service.approve(request.id);
      expect(world.books[BOOK_ID].availableCopies).toBe(1);

      await service.returnLoan(request.id);
      expect(world.books[BOOK_ID].availableCopies).toBe(2);
    });
  });
});

describe('LoansService notifications', () => {
  it('tells lending approvers about a new request, after it is saved', async () => {
    const world = freshWorld();
    const { service, notifications } = buildService(world);

    const loan = await service.createForUser(USER_ID, BOOK_ID);

    expect(world.loans[loan.id]).toBeDefined();
    expect(notifications.loanRequested).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID, name: 'Borrower' }),
      expect.objectContaining({ id: BOOK_ID, title: 'Test Book' }),
    );
  });

  it('sends nothing when the request is refused', async () => {
    const { service, notifications } = buildService(freshWorld({ status: BookStatus.REVIEWING }));

    await expect(service.createForUser(USER_ID, BOOK_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(notifications.loanRequested).not.toHaveBeenCalled();
  });

  it('tells the borrower their request was approved', async () => {
    const world = freshWorld();
    world.loans['loan-1'] = makeLoan();
    const { service, notifications } = buildService(world);

    await service.approve('loan-1');

    expect(notifications.loanApproved).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, status: LoanStatus.ACTIVE }),
      expect.objectContaining({ title: 'Test Book' }),
    );
  });

  it('tells the borrower their request was declined', async () => {
    const world = freshWorld();
    world.loans['loan-1'] = makeLoan();
    const { service, notifications } = buildService(world);

    await service.decline('loan-1');

    expect(notifications.loanDeclined).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, status: LoanStatus.DECLINED }),
      expect.objectContaining({ title: 'Test Book' }),
    );
  });

  it('sends nothing when approving a loan that is not pending', async () => {
    const world = freshWorld();
    world.loans['loan-1'] = makeLoan({ status: LoanStatus.ACTIVE });
    const { service, notifications } = buildService(world);

    await expect(service.approve('loan-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(notifications.loanApproved).not.toHaveBeenCalled();
  });
});

describe('LoansService.getActiveLoans', () => {
  it('lists every loan whose book is still out, overdue included, earliest due first', async () => {
    const { service, loansRepository } = buildService(freshWorld());

    await service.getActiveLoans();

    expect(loansRepository.find).toHaveBeenCalledWith({
      where: [{ status: LoanStatus.ACTIVE }, { status: LoanStatus.OVERDUE }],
      relations: ['book', 'user'],
      order: { dueDate: 'ASC' },
    });
  });
});

describe('LoansService calendar dates', () => {
  // These used to go through new Date('YYYY-MM-DD'), which is UTC midnight;
  // west of UTC the database then stored the day before.
  it('stores the dates of a staff-issued loan exactly as given', async () => {
    const world = freshWorld();
    const { service } = buildService(world);

    const loan = await service.create({ bookId: BOOK_ID, userId: USER_ID, borrowDate: '2026-09-02', dueDate: '2026-09-16' });

    expect(loan.borrowDate).toBe('2026-09-02');
    expect(loan.dueDate).toBe('2026-09-16');
  });

  it('dates a member request today, due in 14 days', async () => {
    const { service } = buildService(freshWorld());

    const loan = await service.createForUser(USER_ID, BOOK_ID);

    expect(loan.borrowDate).toBe(todayDateOnly());
    expect(loan.dueDate).toBe(addDays(todayDateOnly(), 14));
  });

  it('stores an edited return date exactly as given', async () => {
    const world = freshWorld({ availableCopies: 1 });
    world.loans['loan-1'] = makeLoan({ status: LoanStatus.ACTIVE });
    const { service } = buildService(world);

    const loan = await service.update('loan-1', { returnDate: '2026-09-20' });

    expect(loan.returnDate).toBe('2026-09-20');
    expect(loan.status).toBe(LoanStatus.RETURNED);
  });
});

describe('LoansService loan period', () => {
  it('starts the loan period when a request is approved, not when it was made', async () => {
    const world = freshWorld();
    // Requested 20 days ago: under the old rule it would be due 6 days ago.
    world.loans['loan-1'] = makeLoan({ borrowDate: addDays(todayDateOnly(), -20), dueDate: addDays(todayDateOnly(), -6) });
    const { service, notifications } = buildService(world);

    const loan = await service.approve('loan-1');

    expect(loan.borrowDate).toBe(todayDateOnly());
    expect(loan.dueDate).toBe(addDays(todayDateOnly(), 14));
    expect(notifications.loanApproved).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: addDays(todayDateOnly(), 14) }),
      expect.anything(),
    );
  });
});
