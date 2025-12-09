import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { Group } from './entities/group.entity';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [TypeOrmModule.forFeature([Group]), RolesModule],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule implements OnModuleInit {
  constructor(private groupsService: GroupsService) {}

  async onModuleInit() {
    // Ensure default groups exist when module initializes
    await this.groupsService.ensureDefaultGroupsExist();
  }
}
