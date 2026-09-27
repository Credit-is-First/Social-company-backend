import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { User } from '../../users/entities/user.entity';

export enum NotificationType {
  LOAN_REQUESTED = 'loan_requested',
  LOAN_APPROVED = 'loan_approved',
  LOAN_DECLINED = 'loan_declined',
  BOOK_REVIEW_REQUESTED = 'book_review_requested',
  BOOK_APPROVED = 'book_approved',
  BOOK_DECLINED = 'book_declined',
}

/**
 * One alert for one user. Stored rather than only pushed, so the bell still
 * shows what arrived while the user was offline or had the page closed.
 */
@Entity('notifications')
@Index('IDX_notifications_user_created', ['userId', 'createdAt'])
export class Notification {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 36 })
  userId: string;

  @ApiProperty({ enum: NotificationType })
  @Column({ type: 'varchar', length: 40 })
  type: NotificationType;

  @ApiProperty()
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 500 })
  message: string;

  /** Frontend route to open when the notification is clicked. */
  @ApiProperty({ required: false })
  @Column({ type: 'varchar', length: 255, nullable: true })
  link: string | null;

  @ApiProperty({ required: false })
  @Column({ type: 'timestamp', nullable: true })
  readAt: Date | null;

  @Exclude()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
