import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { Loan } from '../loans/entities/loan.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { RolesModule } from '../roles/roles.module';
import { GroupsModule } from '../groups/groups.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, Loan, RefreshToken]), RolesModule, GroupsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

