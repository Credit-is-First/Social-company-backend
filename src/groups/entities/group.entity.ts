import { Entity, Column, PrimaryGeneratedColumn, ManyToMany, JoinTable } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { Role } from '../../roles/entities/role.entity';

@Entity('groups')
export class Group {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ unique: true })
  name: string;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  description: string;

  @ApiProperty()
  @Column({ default: false })
  isDefault: boolean; // True for default groups (super admin, admin, librarian)

  @ManyToMany(() => User, user => user.groups)
  users: User[];

  @ManyToMany(() => Role, role => role.groups, { eager: true })
  @JoinTable({
    name: 'group_roles',
    joinColumn: { name: 'groupId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'roleId', referencedColumnName: 'id' },
  })
  roles: Role[];

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
