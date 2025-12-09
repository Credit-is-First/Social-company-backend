import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { RolesService } from '../roles/roles.service';
import { GroupsService } from '../groups/groups.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private rolesService: RolesService,
    private groupsService: GroupsService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const user = this.usersRepository.create(createUserDto);
    
    // Assign roles if specified
    if (createUserDto.roleIds && Array.isArray(createUserDto.roleIds) && createUserDto.roleIds.length > 0) {
      const roles = await Promise.all(
        createUserDto.roleIds.map(roleId => this.rolesService.findOne(roleId))
      );
      user.roles = roles.filter(r => r !== undefined);
    } else {
      user.roles = [];
    }
    
    return await this.usersRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return await this.usersRepository.find({
      relations: ['roles', 'groups', 'groups.roles'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { id },
      relations: ['loans', 'roles', 'groups', 'groups.roles'],
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);
    
    // Handle role updates
    if (updateUserDto.roleIds && Array.isArray(updateUserDto.roleIds)) {
      const roles = await Promise.all(
        updateUserDto.roleIds.map(roleId => this.rolesService.findOne(roleId))
      );
      user.roles = roles;
      delete updateUserDto.roleIds;
    }
    
    Object.assign(user, updateUserDto);
    return await this.usersRepository.save(user);
  }

  async updateUserRoles(userId: string, roleIds: string[]): Promise<User> {
    const user = await this.findOne(userId);
    const roles = await Promise.all(
      roleIds.map(roleId => this.rolesService.findOne(roleId))
    );
    user.roles = roles;
    return await this.usersRepository.save(user);
  }

  async updateUserGroups(userId: string, groupIds: string[]): Promise<User> {
    const user = await this.findOne(userId);
    const groups = await Promise.all(
      groupIds.map(groupId => this.groupsService.findOne(groupId))
    );
    
    // Check if trying to assign Super Admin group
    const superAdminGroup = groups.find(g => g.name === 'Super Admin');
    if (superAdminGroup) {
      // Check if any other user already has Super Admin group
      const existingSuperAdmin = await this.usersRepository
        .createQueryBuilder('user')
        .innerJoin('user.groups', 'group')
        .where('group.name = :groupName', { groupName: 'Super Admin' })
        .andWhere('user.id != :userId', { userId })
        .getOne();
      
      if (existingSuperAdmin) {
        throw new BadRequestException('Super Admin group can only have one member');
      }
    }
    
    user.groups = groups;
    return await this.usersRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.usersRepository.remove(user);
  }

  async search(query: string): Promise<User[]> {
    return await this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'roles')
      .leftJoinAndSelect('user.groups', 'groups')
      .leftJoinAndSelect('groups.roles', 'groupRoles')
      .where('user.name LIKE :query', { query: `%${query}%` })
      .orWhere('user.email LIKE :query', { query: `%${query}%` })
      .orWhere('user.phone LIKE :query', { query: `%${query}%` })
      .orderBy('user.createdAt', 'DESC')
      .getMany();
  }

  async count(): Promise<number> {
    return await this.usersRepository.count();
  }

  async blockUser(userId: string, blocked: boolean): Promise<User> {
    const user = await this.findOne(userId);
    user.blocked = blocked;
    return await this.usersRepository.save(user);
  }

  async resetUserPassword(userId: string, newPassword: string): Promise<User> {
    const user = await this.findOne(userId);
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    return await this.usersRepository.save(user);
  }
}
