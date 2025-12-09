import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private rolesRepository: Repository<Role>,
  ) {}

  async findAll(): Promise<Role[]> {
    return await this.rolesRepository.find({
      order: { name: 'ASC' },
    });
  }

  async findOne(id: number): Promise<Role> {
    const role = await this.rolesRepository.findOne(id);
    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }
    return role;
  }

  async findByName(name: string): Promise<Role | undefined> {
    return await this.rolesRepository.findOne({ where: { name } });
  }

  async create(name: string, description?: string): Promise<Role> {
    const role = this.rolesRepository.create({ name, description });
    return await this.rolesRepository.save(role);
  }

  async ensureRolesExist(): Promise<void> {
    const defaultRoles = [
      { name: 'admin', description: 'Administrator with full access' },
      { name: 'librarian', description: 'Librarian who can manage books and loans' },
      { name: 'user', description: 'Regular user who can borrow books' },
    ];

    for (const roleData of defaultRoles) {
      const existingRole = await this.findByName(roleData.name);
      if (!existingRole) {
        await this.create(roleData.name, roleData.description);
      }
    }
  }
}
