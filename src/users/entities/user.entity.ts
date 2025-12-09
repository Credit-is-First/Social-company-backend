import { Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToMany, JoinTable } from 'typeorm';
import { Loan } from '../../loans/entities/loan.entity';
import { Role } from '../../roles/entities/role.entity';
import { ApiProperty } from '@nestjs/swagger';

// Keep enum for backward compatibility and default role assignment
export enum UserRole {
  ADMIN = 'admin',
  LIBRARIAN = 'librarian',
  USER = 'user',
}

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

  @ApiProperty({ required: false })
  @Column({ nullable: true })
  password: string;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  securityQuestion: string;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  securityAnswer: string;

  @ManyToMany(() => Role, role => role.users, { eager: true })
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'roleId', referencedColumnName: 'id' },
  })
  roles: Role[];

  @OneToMany(() => Loan, loan => loan.user)
  loans: Loan[];

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  // Helper method to check if user has a role
  hasRole(roleName: string): boolean {
    return this.roles?.some(role => role.name === roleName) || false;
  }

  // Helper method to get role names array
  getRoleNames(): string[] {
    return this.roles?.map(role => role.name) || [];
  }
}

