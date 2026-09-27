import { BadRequestException, ConflictException } from '@nestjs/common';
import { BooksService, escapeCSV } from './books.service';
import { BookStatus } from './entities/book.entity';
import { BOOK_SORT_FIELDS } from './dto/pagination.dto';
import * as iconv from 'iconv-lite';
import { decodeCsvBuffer, UNREADABLE_CHAR, UTF8_BOM } from './csv-encoding';

function buildService() {
  const saved: any[] = [];
  const existingIsbns = new Set<string>();

  const queryBuilder: any = {
    andWhere: jest.fn(() => queryBuilder),
    orderBy: jest.fn(() => queryBuilder),
    skip: jest.fn(() => queryBuilder),
    take: jest.fn(() => queryBuilder),
    getCount: jest.fn(async () => 0),
    getMany: jest.fn(async () => []),
  };

  const booksRepository: any = {
    findOne: jest.fn(async (options: any) =>
      options && options.where && existingIsbns.has(options.where.isbn) ? { id: 'existing' } : null,
    ),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (book: any) => {
      saved.push(book);
      existingIsbns.add(book.isbn);
      return { ...book, id: `book-${saved.length}` };
    }),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };

  const loansRepository: any = { count: jest.fn(async () => 0) };
  const notifications: any = {
    loanRequested: jest.fn(async () => undefined),
    loanApproved: jest.fn(async () => undefined),
    loanDeclined: jest.fn(async () => undefined),
    bookAwaitingReview: jest.fn(async () => undefined),
    booksAwaitingReview: jest.fn(async () => undefined),
    bookApproved: jest.fn(async () => undefined),
    bookDeclined: jest.fn(async () => undefined),
  };

  return {
    service: new BooksService(booksRepository, loansRepository, notifications),
    notifications,
    booksRepository,
    queryBuilder,
    saved,
    existingIsbns,
  };
}

const HEADER = 'Title,Author,ISBN,Category,Total Copies,Available Copies,Status,Is Ebook';

describe('escapeCSV', () => {
  it('leaves plain values alone', () => {
    expect(escapeCSV('Dune')).toBe('Dune');
  });

  it('returns an empty string for null and undefined', () => {
    expect(escapeCSV(null)).toBe('');
    expect(escapeCSV(undefined)).toBe('');
  });

  it('quotes values containing a comma', () => {
    expect(escapeCSV('Herbert, Frank')).toBe('"Herbert, Frank"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCSV('He said "hi"')).toBe('"He said ""hi"""');
  });

  it('quotes values containing a newline', () => {
    expect(escapeCSV('line one\nline two')).toBe('"line one\nline two"');
  });

  // Without this a title like =cmd|'/c calc'!A0 executes when the export is
  // opened in a spreadsheet.
  it.each(['=1+1', '+1', '-1', '@SUM(A1)'])('neutralises the formula prefix in %s', (value) => {
    expect(escapeCSV(value).replace(/^"|"$/g, '').charAt(0)).toBe("'");
  });

  it('still quotes a formula that also contains a comma', () => {
    expect(escapeCSV('=A1,B2')).toBe('"\'=A1,B2"');
  });
});

describe('BooksService.findWithPagination', () => {
  it('only ever orders by a whitelisted column', async () => {
    const { service, queryBuilder } = buildService();

    await service.findWithPagination({ sortBy: 'title', sortOrder: 'ASC' } as any, true);

    expect(queryBuilder.orderBy).toHaveBeenCalledWith('book.title', 'ASC');
  });

  it('falls back to createdAt for an unknown sort column', async () => {
    const { service, queryBuilder } = buildService();

    await service.findWithPagination({ sortBy: 'id; DROP TABLE books' } as any, true);

    expect(queryBuilder.orderBy).toHaveBeenCalledWith('book.createdAt', 'DESC');
  });

  it('coerces an unexpected sort direction to DESC', async () => {
    const { service, queryBuilder } = buildService();

    await service.findWithPagination({ sortBy: 'title', sortOrder: 'ASC, (SELECT 1)' } as any, true);

    expect(queryBuilder.orderBy).toHaveBeenCalledWith('book.title', 'DESC');
  });

  it('exposes only safe sort fields', () => {
    BOOK_SORT_FIELDS.forEach(field => expect(field).toMatch(/^[a-zA-Z]+$/));
  });

  it('pins callers without book:read to approved books', async () => {
    const { service, queryBuilder } = buildService();

    await service.findWithPagination({ status: BookStatus.REVIEWING } as any, false);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith('book.status = :approvedStatus', {
      approvedStatus: BookStatus.APPROVED,
    });
  });

  it('honours a requested status for callers with book:read', async () => {
    const { service, queryBuilder } = buildService();

    await service.findWithPagination({ status: BookStatus.REVIEWING } as any, true);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith('book.status = :status', {
      status: BookStatus.REVIEWING,
    });
  });
});

describe('BooksService.create', () => {
  it('rejects a duplicate ISBN with a conflict rather than a driver error', async () => {
    const { service, existingIsbns } = buildService();
    existingIsbns.add('111');

    await expect(
      service.create({ title: 'T', author: 'A', isbn: '111', category: 'C', totalCopies: 1 } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('starts a book in review when the creator cannot approve', async () => {
    const { service, saved } = buildService();

    await service.create({ title: 'T', author: 'A', isbn: '222', category: 'C', totalCopies: 3 } as any);

    expect(saved[0].status).toBe(BookStatus.REVIEWING);
    expect(saved[0].availableCopies).toBe(3);
  });

  it('auto-approves for a creator holding book:approve', async () => {
    const { service, saved } = buildService();
    const approver = { id: 'u1', hasRole: (role: string) => role === 'book:approve' };

    await service.create(
      { title: 'T', author: 'A', isbn: '333', category: 'C', totalCopies: 1 } as any,
      undefined,
      approver,
    );

    expect(saved[0].status).toBe(BookStatus.APPROVED);
    expect(saved[0].approvedBy).toBe('u1');
  });
});

describe('BooksService.importFromCSV', () => {
  it('imports valid rows', async () => {
    const { service } = buildService();

    const result = await service.importFromCSV(`${HEADER}\nDune,Herbert,111,SciFi,2,2,approved,No`);

    expect(result.success).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('rejects a file missing a required column', async () => {
    const { service } = buildService();

    await expect(service.importFromCSV('Title,Author\nDune,Herbert')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a file with no data rows', async () => {
    const { service } = buildService();

    await expect(service.importFromCSV(HEADER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown status value', async () => {
    const { service } = buildService();

    await expect(
      service.importFromCSV(`${HEADER}\nDune,Herbert,111,SciFi,2,2,banana,No`),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ignores the Status column for importers who cannot approve', async () => {
    const { service, saved } = buildService();

    await service.importFromCSV(`${HEADER}\nDune,Herbert,111,SciFi,2,2,approved,No`);

    expect(saved[0].status).toBe(BookStatus.REVIEWING);
  });

  it('honours the Status column for an approver', async () => {
    const { service, saved } = buildService();
    const approver = { id: 'u1', hasRole: (role: string) => role === 'book:approve' };

    await service.importFromCSV(`${HEADER}\nDune,Herbert,111,SciFi,2,2,approved,No`, approver);

    expect(saved[0].status).toBe(BookStatus.APPROVED);
  });

  it('honours the Available Copies column', async () => {
    const { service, saved } = buildService();

    await service.importFromCSV(`${HEADER}\nDune,Herbert,111,SciFi,5,2,reviewing,No`);

    expect(saved[0].totalCopies).toBe(5);
    expect(saved[0].availableCopies).toBe(2);
  });

  it('clamps Available Copies to Total Copies', async () => {
    const { service, saved } = buildService();

    await service.importFromCSV(`${HEADER}\nDune,Herbert,111,SciFi,2,99,reviewing,No`);

    expect(saved[0].availableCopies).toBe(2);
  });

  it('parses quoted fields containing commas', async () => {
    const { service, saved } = buildService();

    await service.importFromCSV(`${HEADER}\n"Dune, Part One",Herbert,111,SciFi,1,1,reviewing,No`);

    expect(saved[0].title).toBe('Dune, Part One');
  });

  it('reports a duplicate ISBN as a row error without aborting the import', async () => {
    const { service, existingIsbns } = buildService();
    existingIsbns.add('111');

    const result = await service.importFromCSV(
      `${HEADER}\nDune,Herbert,111,SciFi,1,1,reviewing,No\nOther,Author,222,SciFi,1,1,reviewing,No`,
    );

    expect(result.errors).toBe(1);
    expect(result.success).toBe(1);
    expect(result.results[0].message).toContain('111');
  });

  it('handles CRLF line endings', async () => {
    const { service } = buildService();

    const result = await service.importFromCSV(`${HEADER}\r\nDune,Herbert,111,SciFi,1,1,reviewing,No\r\n`);

    expect(result.success).toBe(1);
  });

  it('imports Chinese text', async () => {
    const { service, saved } = buildService();

    await service.importFromCSV(`${HEADER}\n三体,刘慈欣,9787536692930,科幻,3,3,reviewing,No`);

    expect(saved[0]).toMatchObject({ title: '三体', author: '刘慈欣', category: '科幻' });
  });

  it('imports a GBK file from Excel once it is decoded', async () => {
    const { service, saved } = buildService();
    const upload = iconv.encode(`${HEADER}\r\n三体,刘慈欣,9787536692930,科幻,3,3,reviewing,No\r\n`, 'gbk');

    await service.importFromCSV(decodeCsvBuffer(upload).text);

    expect(saved[0]).toMatchObject({ title: '三体', author: '刘慈欣', category: '科幻' });
  });

  it('rejects the whole file when a row has characters that could not be read', async () => {
    const { service, saved } = buildService();
    const garbled = `Dune,Herbert,111,SciFi,1,1,reviewing,No\n${UNREADABLE_CHAR}${UNREADABLE_CHAR},A,222,SciFi,1,1,reviewing,No`;

    await expect(service.importFromCSV(`${HEADER}\n${garbled}`)).rejects.toThrow(/Row 3: .*CSV UTF-8/);
    expect(saved).toHaveLength(0);
  });

  it('reads back its own export', async () => {
    const { service, queryBuilder, saved } = buildService();
    queryBuilder.getMany.mockResolvedValueOnce([
      { title: '三体', author: '刘慈欣', isbn: '9787536692930', category: '科幻', totalCopies: 3, availableCopies: 3, status: 'reviewing', isEbook: false },
    ]);

    await service.importFromCSV(await service.exportToCSV());

    expect(saved[0]).toMatchObject({ title: '三体', author: '刘慈欣', isbn: '9787536692930' });
  });
});

describe('BooksService.exportToCSV', () => {
  it('starts with a UTF-8 BOM so Excel opens Chinese text correctly', async () => {
    const { service, queryBuilder } = buildService();
    queryBuilder.getMany.mockResolvedValueOnce([
      { title: '三体', author: '刘慈欣', isbn: '9787536692930', category: '科幻', totalCopies: 3, availableCopies: 3, status: 'approved', isEbook: false },
    ]);

    const csv = await service.exportToCSV();

    expect(csv.charAt(0)).toBe(UTF8_BOM);
    expect(csv.slice(1).split('\n')[1]).toMatch(/^三体,刘慈欣,9787536692930,科幻,3,3,approved,No,/);
  });
});

describe('BooksService review notifications', () => {
  const dto = { title: 'Dune', author: 'Herbert', isbn: '111', category: 'SciFi', totalCopies: 1 } as any;

  it('tells book approvers when a new book enters review', async () => {
    const { service, notifications } = buildService();
    const member = { id: 'm1', hasRole: () => false };

    await service.create(dto, undefined, member);

    expect(notifications.bookAwaitingReview).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Dune', status: BookStatus.REVIEWING }),
      'm1',
    );
  });

  it('sends nothing for a book an approver adds (it is approved at once)', async () => {
    const { service, notifications } = buildService();
    const approver = { id: 'u1', hasRole: (role: string) => role === 'book:approve' };

    await service.create(dto, undefined, approver);

    expect(notifications.bookAwaitingReview).not.toHaveBeenCalled();
  });

  it('sends one summary for a CSV import instead of one alert per row', async () => {
    const { service, notifications } = buildService();

    await service.importFromCSV(
      `${HEADER}\nDune,Herbert,111,SciFi,1,1,reviewing,No\nEmma,Austen,222,Classic,1,1,reviewing,No`,
      { id: 'm1', hasRole: () => false },
    );

    expect(notifications.bookAwaitingReview).not.toHaveBeenCalled();
    expect(notifications.booksAwaitingReview).toHaveBeenCalledTimes(1);
    expect(notifications.booksAwaitingReview).toHaveBeenCalledWith(2, 'm1');
  });

  it('tells book approvers when a declined book is sent back for review', async () => {
    const { service, booksRepository, notifications } = buildService();
    booksRepository.findOne.mockResolvedValueOnce({ id: 'b1', title: 'Dune', isbn: '111', status: BookStatus.DECLINED });

    await service.update('b1', {} as any, undefined, true, 'm1');

    expect(notifications.bookAwaitingReview).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Dune', status: BookStatus.REVIEWING }),
      'm1',
    );
  });
});

describe('BooksService submitter notifications', () => {
  const dto = { title: 'Dune', author: 'Herbert', isbn: '111', category: 'SciFi', totalCopies: 1 } as any;

  it('records who submitted a new book', async () => {
    const { service, saved } = buildService();

    await service.create(dto, undefined, { id: 'm1', hasRole: () => false });

    expect(saved[0].submittedBy).toBe('m1');
  });

  it('records whoever sends a book back for review as its submitter', async () => {
    const { service, booksRepository, saved } = buildService();
    booksRepository.findOne.mockResolvedValueOnce({ id: 'b1', title: 'Dune', isbn: '111', status: BookStatus.DECLINED, submittedBy: 'old' });

    await service.update('b1', {} as any, undefined, true, 'm2');

    expect(saved[0].submittedBy).toBe('m2');
  });

  it('keeps the submitter on an ordinary edit', async () => {
    const { service, booksRepository, saved } = buildService();
    booksRepository.findOne.mockResolvedValueOnce({ id: 'b1', title: 'Dune', isbn: '111', status: BookStatus.WORKING, submittedBy: 'm1' });

    await service.update('b1', { title: 'Dune (2nd ed.)' } as any, undefined, false, 'editor');

    expect(saved[0].submittedBy).toBe('m1');
  });

  it('tells the submitter when their book is approved', async () => {
    const { service, booksRepository, notifications } = buildService();
    booksRepository.findOne.mockResolvedValueOnce({ id: 'b1', title: 'Dune', status: BookStatus.REVIEWING, submittedBy: 'm1' });

    await service.approve('b1', 'approver');

    expect(notifications.bookApproved).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Dune', status: BookStatus.APPROVED, submittedBy: 'm1' }),
      'approver',
    );
  });

  it('tells the submitter when their book is declined, with the reason', async () => {
    const { service, booksRepository, notifications } = buildService();
    booksRepository.findOne.mockResolvedValueOnce({ id: 'b1', title: 'Dune', status: BookStatus.REVIEWING, submittedBy: 'm1' });

    await service.decline('b1', 'approver', 'Wrong ISBN');

    expect(notifications.bookDeclined).toHaveBeenCalledWith(
      expect.objectContaining({ status: BookStatus.DECLINED, submittedBy: 'm1' }),
      'approver',
      'Wrong ISBN',
    );
  });

  it('sends nothing when the status does not change', async () => {
    const { service, booksRepository, notifications } = buildService();
    booksRepository.findOne
      .mockResolvedValueOnce({ id: 'b1', title: 'Dune', status: BookStatus.APPROVED, submittedBy: 'm1' })
      .mockResolvedValueOnce({ id: 'b1', title: 'Dune', status: BookStatus.DECLINED, submittedBy: 'm1' });

    await service.approve('b1', 'approver');
    await service.decline('b1', 'approver', 'Still wrong');

    expect(notifications.bookApproved).not.toHaveBeenCalled();
    expect(notifications.bookDeclined).not.toHaveBeenCalled();
  });
});

describe('BooksService published date', () => {
  it('stores the published date exactly as given', async () => {
    const { service, saved } = buildService();

    await service.create(
      { title: 'Dune', author: 'Herbert', isbn: '111', category: 'SciFi', totalCopies: 1, publishedDate: '2008-01-01' } as any,
      undefined,
      { id: 'u1', hasRole: () => true },
    );

    expect(saved[0].publishedDate).toBe('2008-01-01');
  });
});
