import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { Role } from './entities/role.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Role])],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule implements OnModuleInit {
  constructor(private rolesService: RolesService) {}

  async onModuleInit() {
    // Ensure all roles from ROLE_DEFINITIONS exist when module initializes
    await this.rolesService.ensureRolesExist();
  }
}
