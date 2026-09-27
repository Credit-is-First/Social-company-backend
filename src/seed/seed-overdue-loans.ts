import { INestApplicationContext } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Book, BookStatus } from '../books/entities/book.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';
import { LoansService } from '../loans/loans.service';
import { Gender, User } from '../users/entities/user.entity';
import { Group } from '../groups/entities/group.entity';
import { DEFAULT_MEMBER_GROUP } from '../roles/roles.constants';
import { addDays, todayDateOnly } from '../common/date-only';

/** Loans run for 14 days, as a member's own request does. */
const LOAN_DAYS = 14;

interface SampleMember {
  name: string;
  email: string;
  phone: string;
  address: string;
  occupation: string;
  dateOfBirth: string;
  gender: Gender;
  /** How many days ago the loan fell due. */
  daysOverdue: number;
}

const SAMPLE_MEMBERS: SampleMember[] = [
  { name: '林伟 (Lin Wei)', email: 'sample.linwei@library.local', phone: '13800000001', address: '12 Harbour Road', occupation: 'Engineer', dateOfBirth: '1988-04-12', gender: Gender.MALE, daysOverdue: 25 },
  { name: 'Maria Santos', email: 'sample.msantos@library.local', phone: '5550100002', address: '48 Elm Street', occupation: 'Teacher', dateOfBirth: '1992-09-30', gender: Gender.FEMALE, daysOverdue: 10 },
  { name: '陈静 (Chen Jing)', email: 'sample.chenjing@library.local', phone: '13800000003', address: '7 Garden Lane', occupation: 'Student', dateOfBirth: '2003-01-18', gender: Gender.FEMALE, daysOverdue: 3 },
  { name: 'James Carter', email: 'sample.jcarter@library.local', phone: '5550100004', address: '90 Mill Road', occupation: 'Nurse', dateOfBirth: '1979-06-05', gender: Gender.MALE, daysOverdue: 1 },
];

/** The local calendar date `days` from today, as YYYY-MM-DD. */
const dateFromToday = (days: number): string => addDays(todayDateOnly(), days);

/**
 * Sample members with overdue loans, for trying out the Overdue tab and the
 * reminders.
 *
 * Each loan is issued through LoansService.create, the same path as staff
 * issuing a loan, so a copy is really taken from the book. It is then marked
 * overdue but not yet reminded, so the next reminder run ("Send reminders" or
 * the hourly job) notifies the borrowers and lending staff.
 *
 * Safe to run again: existing sample members are reused and a member who
 * already has an open loan is skipped. Books must be approved and have a
 * spare copy; the seed never takes a book's last copy.
 *
 * The members' password is SEED_MEMBER_PASSWORD when set (so you can sign in
 * as them); otherwise a random one that is never shown.
 */
export async function seedOverdueLoans(app: INestApplicationContext) {
  const usersRepository = app.get<Repository<User>>(getRepositoryToken(User));
  const groupsRepository = app.get<Repository<Group>>(getRepositoryToken(Group));
  const booksRepository = app.get<Repository<Book>>(getRepositoryToken(Book));
  const loansRepository = app.get<Repository<Loan>>(getRepositoryToken(Loan));
  const loansService = app.get(LoansService);

  console.log('\n⏰ Seeding overdue loans...');

  const memberGroup = await groupsRepository.findOne({ where: { name: DEFAULT_MEMBER_GROUP } });
  if (!memberGroup) {
    console.log(`⚠️  No "${DEFAULT_MEMBER_GROUP}" group yet. Start the backend once so it seeds roles and groups, then retry.`);
    return;
  }

  const password = process.env.SEED_MEMBER_PASSWORD || crypto.randomBytes(18).toString('hex');
  const passwordHash = await bcrypt.hash(password, 10);

  const books = (await booksRepository.find({ where: { status: BookStatus.APPROVED }, order: { title: 'ASC' } })).filter(
    book => book.availableCopies >= 2,
  );
  const usedBookIds = new Set<string>();

  let created = 0;
  let skipped = 0;

  for (const sample of SAMPLE_MEMBERS) {
    let member = await usersRepository.findOne({ where: { email: sample.email } });
    if (!member) {
      member = await usersRepository.save(
        usersRepository.create({
          name: sample.name,
          email: sample.email,
          phone: sample.phone,
          address: sample.address,
          occupation: sample.occupation,
          dateOfBirth: sample.dateOfBirth,
          gender: sample.gender,
          password: passwordHash,
          groups: [memberGroup],
          roles: [],
        }),
      );
      console.log(`👤 Added sample member: ${sample.name} <${sample.email}>`);
    }

    const openLoan = await loansRepository.findOne({
      where: { userId: member.id, status: In([LoanStatus.PENDING, LoanStatus.ACTIVE, LoanStatus.OVERDUE]) },
    });
    if (openLoan) {
      console.log(`⏭️  ${sample.name} already has an open loan`);
      skipped++;
      continue;
    }

    const book = books.find(candidate => !usedBookIds.has(candidate.id));
    if (!book) {
      console.log(`⚠️  No approved book with a spare copy left for ${sample.name}; approve more books and retry.`);
      skipped++;
      continue;
    }
    usedBookIds.add(book.id);

    const dueDate = dateFromToday(-sample.daysOverdue);
    const loan = await loansService.create({
      bookId: book.id,
      userId: member.id,
      borrowDate: dateFromToday(-sample.daysOverdue - LOAN_DAYS),
      dueDate,
    });
    await loansRepository.update(loan.id, { status: LoanStatus.OVERDUE });

    console.log(`✅ ${sample.name}: "${book.title}" due ${dueDate} (${sample.daysOverdue} ${sample.daysOverdue === 1 ? 'day' : 'days'} overdue)`);
    created++;
  }

  console.log('\n⏰ Overdue loans seeding completed:');
  console.log(`  - Added: ${created} overdue loans`);
  console.log(`  - Skipped: ${skipped}`);
  if (created > 0) {
    console.log('  Run "Send reminders" in Lending Management to notify the borrowers and staff.');
  }
}
