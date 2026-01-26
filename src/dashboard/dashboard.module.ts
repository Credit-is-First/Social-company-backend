import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Book } from '../books/entities/book.entity';
import { User } from '../users/entities/user.entity';
import { Loan } from '../loans/entities/loan.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Book, User, Loan])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
