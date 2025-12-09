import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { RolesModule } from '../roles/roles.module';
import { GroupsModule } from '../groups/groups.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), RolesModule, GroupsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

