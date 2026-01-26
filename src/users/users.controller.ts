import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { HasRoles } from '../auth/decorators/roles.decorator';
import { Roles } from '../roles/roles.constants';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @HasRoles(Roles.USER_READ)
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ status: 200, description: 'List of all users', type: [User] })
  findAll(@Query('search') search?: string) {
    if (search) {
      return this.usersService.search(search);
    }
    return this.usersService.findAll();
  }

  @Get(':id')
  @HasRoles(Roles.USER_READ)
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiResponse({ status: 200, description: 'User found', type: User })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @HasRoles(Roles.USER_UPDATE)
  @ApiOperation({ summary: 'Update user roles (personal data can only be updated by the user themselves via /auth/profile)' })
  @ApiResponse({ status: 200, description: 'User roles updated successfully', type: User })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Patch(':id/block')
  @HasRoles(Roles.USER_BLOCK)
  @ApiOperation({ summary: 'Block or unblock a user' })
  @ApiResponse({ status: 200, description: 'User block status updated successfully', type: User })
  blockUser(@Param('id') id: string, @Body() body: { blocked: boolean }) {
    return this.usersService.blockUser(id, body.blocked);
  }

  @Patch(':id/reset-password')
  @HasRoles(Roles.USER_RESET_PASSWORD)
  @ApiOperation({ summary: 'Reset user password' })
  @ApiResponse({ status: 200, description: 'User password reset successfully', type: User })
  resetPassword(@Param('id') id: string, @Body() body: { newPassword: string }) {
    return this.usersService.resetUserPassword(id, body.newPassword);
  }

  @Patch(':id/roles')
  @HasRoles(Roles.USER_ROLE_UPDATE)
  @ApiOperation({ summary: 'Update user roles' })
  @ApiResponse({ status: 200, description: 'User roles updated successfully', type: User })
  updateRoles(@Param('id') id: string, @Body() body: { roleIds: string[] }) {
    return this.usersService.updateUserRoles(id, body.roleIds);
  }

  @Patch(':id/groups')
  @HasRoles(Roles.USER_ROLE_UPDATE)
  @ApiOperation({ summary: 'Update user groups' })
  @ApiResponse({ status: 200, description: 'User groups updated successfully', type: User })
  updateGroups(@Param('id') id: string, @Body() body: { groupIds: string[] }) {
    return this.usersService.updateUserGroups(id, body.groupIds);
  }

  @Delete(':id')
  @HasRoles(Roles.USER_DELETE)
  @ApiOperation({ summary: 'Delete a user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}

