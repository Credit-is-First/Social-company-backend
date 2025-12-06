import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Book } from '../../books/entities/book.entity';
import { User } from '../../users/entities/user.entity';
import { ApiProperty } from '@nestjs/swagger';

export enum LoanStatus {
  ACTIVE = 'active',
  RETURNED = 'returned',
  OVERDUE = 'overdue',
}

@Entity('loans')
export class Loan {
  @ApiProperty()
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty()
  @Column()
  bookId: number;

  @ApiProperty()
  @Column()
  userId: number;

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
    default: LoanStatus.ACTIVE,
  })
  status: LoanStatus;

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

