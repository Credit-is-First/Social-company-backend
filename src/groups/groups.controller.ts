import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { Group } from './entities/group.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { HasRoles } from '../auth/decorators/roles.decorator';
import { Roles } from '../roles/roles.constants';

@ApiTags('groups')
@Controller('groups')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @HasRoles(Roles.GROUP_READ)
  @ApiOperation({ summary: 'Get all groups' })
  @ApiResponse({ status: 200, description: 'List of all groups', type: [Group] })
  findAll() {
    return this.groupsService.findAll();
  }

  @Get(':id')
  @HasRoles(Roles.GROUP_READ)
  @ApiOperation({ summary: 'Get a group by ID' })
  @ApiResponse({ status: 200, description: 'Group found', type: Group })
  @ApiResponse({ status: 404, description: 'Group not found' })
  findOne(@Param('id') id: string) {
    return this.groupsService.findOne(id);
  }

  @Post()
  @HasRoles(Roles.GROUP_CREATE)
  @ApiOperation({ summary: 'Create a new group' })
  @ApiResponse({ status: 201, description: 'Group created successfully', type: Group })
  create(@Body() createGroupDto: CreateGroupDto) {
    return this.groupsService.create(
      createGroupDto.name,
      createGroupDto.description,
      createGroupDto.roleIds,
      createGroupDto.isDefault || false,
    );
  }

  @Patch(':id')
  @HasRoles(Roles.GROUP_UPDATE)
  @ApiOperation({ summary: 'Update a group' })
  @ApiResponse({ status: 200, description: 'Group updated successfully', type: Group })
  update(@Param('id') id: string, @Body() updateGroupDto: UpdateGroupDto) {
    return this.groupsService.update(id, updateGroupDto);
  }

  @Delete(':id')
  @HasRoles(Roles.GROUP_DELETE)
  @ApiOperation({ summary: 'Delete a group' })
  @ApiResponse({ status: 200, description: 'Group deleted successfully' })
  remove(@Param('id') id: string) {
    return this.groupsService.delete(id);
  }
}
