import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { ROLE_DEFINITIONS } from './roles.constants';

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

  async findOne(id: string): Promise<Role> {
    const role = await this.rolesRepository.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }
    return role;
  }

  async findByName(name: string): Promise<Role | undefined> {
    return await this.rolesRepository.findOne({
      where: { name },
    });
  }

  async create(
    name: string,
    resource: string,
    action: string,
    description?: string,
  ): Promise<Role> {
    const existingRole = await this.findByName(name);
    if (existingRole) {
      throw new BadRequestException(`Role with name ${name} already exists`);
    }

    const role = this.rolesRepository.create({
      name,
      resource,
      action,
      description,
    });

    return await this.rolesRepository.save(role);
  }


  async ensureRolesExist(): Promise<void> {
    for (const roleDef of ROLE_DEFINITIONS) {
      const existingRole = await this.findByName(roleDef.name);
      if (!existingRole) {
        await this.create(roleDef.name, roleDef.resource, roleDef.action, roleDef.description);
      }
    }
  }
}
