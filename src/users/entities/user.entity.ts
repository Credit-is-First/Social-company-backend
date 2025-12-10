import { Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToMany, JoinTable } from 'typeorm';
import { Loan } from '../../loans/entities/loan.entity';
import { Role } from '../../roles/entities/role.entity';
import { Group } from '../../groups/entities/group.entity';
import { ApiProperty } from '@nestjs/swagger';

@Entity('users')
export class User {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @ApiProperty({ required: false })
  @Column({ default: false })
  blocked: boolean;

  @ManyToMany(() => Role, role => role.users, { eager: true })
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'roleId', referencedColumnName: 'id' },
  })
  roles: Role[];

  @ManyToMany(() => Group, group => group.users, { eager: true })
  @JoinTable({
    name: 'user_groups',
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'groupId', referencedColumnName: 'id' },
  })
  groups: Group[];

  @OneToMany(() => Loan, loan => loan.user)
  loans: Loan[];

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  // Helper method to check if user has a role (direct or from groups)
  hasRole(roleName: string): boolean {
    // Check direct roles
    if (this.roles?.some(role => role.name === roleName)) {
      return true;
    }
    // Check roles from groups
    if (this.groups) {
      for (const group of this.groups) {
        if (group.roles?.some(role => role.name === roleName)) {
          return true;
        }
      }
    }
    return false;
  }

  // Helper method to get all role names (direct + from groups)
  getAllRoleNames(): string[] {
    const roleNames = new Set<string>();
    
    // Add direct roles
    if (this.roles) {
      this.roles.forEach(role => roleNames.add(role.name));
    }
    
    // Add roles from groups
    if (this.groups) {
      this.groups.forEach(group => {
        if (group.roles) {
          group.roles.forEach(role => roleNames.add(role.name));
        }
      });
    }
    
    return Array.from(roleNames);
  }
}

