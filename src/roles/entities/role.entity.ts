import { Entity, Column, PrimaryGeneratedColumn, ManyToMany } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { Group } from '../../groups/entities/group.entity';

@Entity('roles')
export class Role {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ unique: true })
  name: string;

  @ApiProperty()
  @Column({ unique: true })
  resource: string;

  @ApiProperty()
  @Column({ unique: true })
  action: string;

  @ApiProperty({ required: false })
  @Column({ type: 'text', nullable: true })
  description: string;

  @ManyToMany(() => User, user => user.roles)
  users: User[];

  @ManyToMany(() => Group, group => group.roles)
  groups: Group[];

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
