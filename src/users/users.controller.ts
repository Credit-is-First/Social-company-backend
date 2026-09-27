import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Res,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { resolveProfilePhotoPath, profilePhotoContentType } from './profile-photo';
import * as fs from 'fs';

import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { BlockUserDto } from './dto/block-user.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';
import { UpdateUserGroupsDto } from './dto/update-user-groups.dto';
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

  @Post()
  @HasRoles(Roles.USER_CREATE)
  @ApiOperation({ summary: 'Create a user account on someone\'s behalf' })
  @ApiResponse({ status: 201, description: 'User created successfully', type: User })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  create(@CurrentUser() actor: User, @Body() createUserDto: CreateUserDto) {
    return this.usersService.create(actor, createUserDto);
  }

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

  /**
   * Photos are personal data, so this is never a static file. Members may fetch
   * their own; anyone else needs user:read.
   */
  @Get(':id/photo')
  @ApiOperation({ summary: 'Fetch a user\'s profile photo' })
  @ApiResponse({ status: 200, description: 'Image stream' })
  @ApiResponse({ status: 404, description: 'No photo set' })
  async getPhoto(@Param('id') id: string, @Res() res: Response, @CurrentUser() requester: User) {
    const isSelf = requester && requester.id === id;
    const canReadUsers = requester && typeof requester.hasRole === 'function' && requester.hasRole(Roles.USER_READ);
    if (!isSelf && !canReadUsers) {
      throw new ForbiddenException('You may only view your own profile photo');
    }

    const user = await this.usersService.findOne(id);
    const absolutePath = user.photoPath ? resolveProfilePhotoPath(user.photoPath) : null;
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      throw new NotFoundException('This user has no profile photo');
    }

    res.setHeader('Content-Type', profilePhotoContentType(absolutePath));
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(absolutePath).pipe(res);
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
  update(@CurrentUser() actor: User, @Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(actor, id, updateUserDto);
  }

  @Patch(':id/block')
  @HasRoles(Roles.USER_BLOCK)
  @ApiOperation({ summary: 'Block or unblock a user' })
  @ApiResponse({ status: 200, description: 'User block status updated successfully', type: User })
  blockUser(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: BlockUserDto) {
    return this.usersService.blockUser(actor, id, body.blocked);
  }

  @Patch(':id/reset-password')
  @HasRoles(Roles.USER_RESET_PASSWORD)
  @ApiOperation({ summary: 'Reset user password' })
  @ApiResponse({ status: 200, description: 'User password reset successfully', type: User })
  resetPassword(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: ResetUserPasswordDto) {
    return this.usersService.resetUserPassword(actor, id, body.newPassword);
  }

  @Patch(':id/roles')
  @HasRoles(Roles.USER_ROLE_UPDATE)
  @ApiOperation({ summary: 'Update user roles' })
  @ApiResponse({ status: 200, description: 'User roles updated successfully', type: User })
  updateRoles(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: UpdateUserRolesDto) {
    return this.usersService.updateUserRoles(actor, id, body.roleIds);
  }

  @Post(':id/transfer-super-admin')
  @HasRoles(Roles.USER_ROLE_UPDATE)
  @ApiOperation({ summary: 'Hand the Super Admin role from the caller (its current holder) to this user' })
  @ApiResponse({ status: 201, description: 'Transferred; returns the new holder', type: User })
  @ApiResponse({ status: 403, description: 'The caller is not the Super Admin' })
  transferSuperAdmin(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.usersService.transferSuperAdmin(actor, id);
  }

  @Patch(':id/groups')
  @HasRoles(Roles.USER_ROLE_UPDATE)
  @ApiOperation({ summary: 'Update user groups' })
  @ApiResponse({ status: 200, description: 'User groups updated successfully', type: User })
  updateGroups(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: UpdateUserGroupsDto) {
    return this.usersService.updateUserGroups(actor, id, body.groupIds);
  }

  @Delete(':id')
  @HasRoles(Roles.USER_DELETE)
  @ApiOperation({ summary: 'Delete a user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  remove(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.usersService.remove(actor, id);
  }
}

