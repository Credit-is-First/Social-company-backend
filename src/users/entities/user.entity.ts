import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { Loan } from '../../loans/entities/loan.entity';
import { ApiProperty } from '@nestjs/swagger';

@Entity('users')
export class User {
  @ApiProperty()
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty()
  @Column()
  name: string;

  @ApiProperty()
  @Column({ unique: true })
  email: string;

  @ApiProperty()
  @Column()
  phone: string;

  @ApiProperty()
  @Column({ type: 'text', nullable: true })
  address: string;

  @OneToMany(() => Loan, loan => loan.user)
  loans: Loan[];

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}

