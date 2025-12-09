import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { Loan } from '../../loans/entities/loan.entity';
import { ApiProperty } from '@nestjs/swagger';

@Entity('books')
export class Book {
  @ApiProperty()
  @PrimaryGeneratedColumn()
  id: number;

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

  @OneToMany(() => Loan, loan => loan.book)
  loans: Loan[];

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}

