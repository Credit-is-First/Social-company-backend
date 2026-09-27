import { Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToMany, JoinTable } from 'typeorm';
import { Loan } from '../../loans/entities/loan.entity';
import { Role } from '../../roles/entities/role.entity';
import { Group } from '../../groups/entities/group.entity';
import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

/**
 * Everything a member must supply before they may borrow.
 *
 * "prefer_not_to_say" is a valid answer for gender, so the requirement is that
 * the question has been answered, not that a particular answer was given.
 */
export const REQUIRED_PROFILE_FIELDS = [
  'name',
  'phone',
  'address',
  'dateOfBirth',
  'gender',
  'occupation',
  'photoPath',
] as const;

export const PROFILE_FIELD_LABELS: { [key: string]: string } = {
  name: 'Full name',
  phone: 'Phone number',
  address: 'Address',
  dateOfBirth: 'Date of birth',
  gender: 'Gender',
  occupation: 'Occupation',
  photoPath: 'Profile photo',
};

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

  @ApiProperty({ required: false, description: 'YYYY-MM-DD' })
  @Column({ type: 'date', nullable: true })
  dateOfBirth: string | null;

  @ApiProperty({ required: false, enum: Gender })
  @Column({ type: 'enum', enum: Gender, nullable: true })
  gender: Gender;

  @ApiProperty({ required: false })
  @Column({ type: 'varchar', length: 120, nullable: true })
  occupation: string;

  /** Stored path of the uploaded photo; served through a guarded route. */
  @ApiProperty({ required: false })
  @Column({ type: 'varchar', length: 500, nullable: true })
  photoPath: string;

  // The three fields below are secrets. @Exclude() keeps them out of every
  // serialised response via the global ClassSerializerInterceptor.
  @Exclude()
  @Column({ nullable: true })
  password: string;

  @Exclude()
  @Column({ type: 'text', nullable: true })
  securityQuestion: string;

  @Exclude()
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

  /**
   * Required profile fields that are still blank.
   *
   * Serialised onto every user response (via @Expose on a getter) so the
   * frontend can tell the member exactly what is outstanding rather than just
   * refusing the borrow.
   */
  @ApiProperty({ type: [String] })
  @Expose()
  get missingProfileFields(): string[] {
    return REQUIRED_PROFILE_FIELDS.filter(field => {
      const value = (this as any)[field];
      return value === null || value === undefined || String(value).trim() === '';
    }).map(field => PROFILE_FIELD_LABELS[field] || field);
  }

  @ApiProperty()
  @Expose()
  get profileComplete(): boolean {
    return this.missingProfileFields.length === 0;
  }

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

