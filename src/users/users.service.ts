import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { RolesService } from '../roles/roles.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private rolesService: RolesService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    // Ensure default roles exist
    await this.rolesService.ensureRolesExist();
    
    const user = this.usersRepository.create(createUserDto);
    
    // Assign default role if specified, otherwise assign 'user' role
    if (createUserDto.role) {
      const role = await this.rolesService.findByName(createUserDto.role);
      if (role) {
        user.roles = [role];
      } else {
        // Fallback to 'user' role if specified role not found
        const defaultRole = await this.rolesService.findByName('user');
        user.roles = defaultRole ? [defaultRole] : [];
      }
    } else {
      const defaultRole = await this.rolesService.findByName('user');
      user.roles = defaultRole ? [defaultRole] : [];
    }
    
    return await this.usersRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return await this.usersRepository.find({
      relations: ['roles'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<User> {
    const user = await this.usersRepository.findOne(id, {
      relations: ['loans', 'roles'],
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto): Promise<User> {
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

  async updateUserRoles(userId: number, roleIds: number[]): Promise<User> {
    const user = await this.findOne(userId);
    const roles = await Promise.all(
      roleIds.map(roleId => this.rolesService.findOne(roleId))
    );
    user.roles = roles;
    return await this.usersRepository.save(user);
  }

  async remove(id: number): Promise<void> {
    const user = await this.findOne(id);
    await this.usersRepository.remove(user);
  }

  async search(query: string): Promise<User[]> {
    return await this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'roles')
      .where('user.name LIKE :query', { query: `%${query}%` })
      .orWhere('user.email LIKE :query', { query: `%${query}%` })
      .orWhere('user.phone LIKE :query', { query: `%${query}%` })
      .orderBy('user.createdAt', 'DESC')
      .getMany();
  }

  async count(): Promise<number> {
    return await this.usersRepository.count();
  }
}

