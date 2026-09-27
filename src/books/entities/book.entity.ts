import { Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { Loan } from '../../loans/entities/loan.entity';
import { User } from '../../users/entities/user.entity';
import { ApiProperty } from '@nestjs/swagger';

export enum BookStatus {
  WORKING = 'working',
  REVIEWING = 'reviewing',
  APPROVED = 'approved',
  DECLINED = 'declined',
  DEPRECATED = 'deprecated',
}

@Entity('books')
export class Book {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column()
  title: string;

  @ApiProperty()
  @Column()
  author: string;

  @ApiProperty()
  @Column({ unique: true })
  isbn: string;

  @ApiProperty()
  @Column()
  category: string;

  @ApiProperty()
  @Column({ type: 'int', default: 0 })
  totalCopies: number;

  @ApiProperty()
  @Column({ type: 'int', default: 0 })
  availableCopies: number;

  @ApiProperty()
  @Column({ type: 'text', nullable: true })
  description: string;

  @ApiProperty()
  @Column({ type: 'date', nullable: true })
  publishedDate: Date;

  @ApiProperty({ required: false })
  @Column({ type: 'boolean', default: false })
  isEbook: boolean;

  @ApiProperty({ required: false })
  @Column({ type: 'varchar', length: 500, nullable: true })
  filePath: string;

  @ApiProperty({ enum: BookStatus })
  @Column({
    type: 'enum',
    enum: BookStatus,
      default: BookStatus.REVIEWING,
  })
  status: BookStatus;

  @ApiProperty({ required: false })
  @Column({ type: 'varchar', length: 36, nullable: true })
  approvedBy: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approvedBy' })
  approvedByUser: User;

  /**
   * Who last sent the book for review (on creation, or by requesting review
   * again), so they can be told when it is approved or declined. Null for
   * books created before this was recorded, or whose submitter was deleted.
   */
  @ApiProperty({ required: false })
  @Column({ type: 'varchar', length: 36, nullable: true })
  submittedBy: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'submittedBy' })
  submittedByUser: User;

  @ApiProperty({ required: false })
  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  deprecationReason: string;

  @OneToMany(() => Loan, loan => loan.book)
  loans: Loan[];

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}

