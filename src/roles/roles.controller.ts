import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { Role } from './entities/role.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('roles')
@Controller('roles')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all roles' })
  @ApiResponse({ status: 200, description: 'List of all roles', type: [Role] })
  findAll() {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiResponse({ status: 200, description: 'Role found', type: Role })
  @ApiResponse({ status: 404, description: 'Role not found' })
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }
}
