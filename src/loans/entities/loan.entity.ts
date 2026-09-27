import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Book } from '../../books/entities/book.entity';
import { User } from '../../users/entities/user.entity';
import { ApiProperty } from '@nestjs/swagger';

export enum LoanStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  RETURNED = 'returned',
  OVERDUE = 'overdue',
  DECLINED = 'declined',
}

@Entity('loans')
export class Loan {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 36 })
  bookId: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @ApiProperty()
  @Column({ type: 'date' })
  borrowDate: Date;

  @ApiProperty()
  @Column({ type: 'date' })
  dueDate: Date;

  @ApiProperty()
  @Column({ type: 'date', nullable: true })
  returnDate: Date;

  @ApiProperty({ enum: LoanStatus })
  @Column({
    type: 'enum',
    enum: LoanStatus,
    default: LoanStatus.PENDING,
  })
  status: LoanStatus;

  /** When the one "due soon" reminder went out; null until then. */
  @ApiProperty({ required: false })
  @Column({ type: 'timestamp', nullable: true })
  dueSoonNotifiedAt: Date | null;

  /** When the borrower was last reminded that the loan is overdue. */
  @ApiProperty({ required: false })
  @Column({ type: 'timestamp', nullable: true })
  overdueNotifiedAt: Date | null;

  @ManyToOne(() => Book, book => book.loans)
  @JoinColumn({ name: 'bookId' })
  book: Book;

  @ManyToOne(() => User, user => user.loans)
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}

