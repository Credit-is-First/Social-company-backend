import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group } from './entities/group.entity';
import { RolesService } from '../roles/roles.service';
import { Roles } from '../roles/roles.constants';

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group)
    private groupsRepository: Repository<Group>,
    private rolesService: RolesService,
  ) {}

  async findAll(): Promise<Group[]> {
    return await this.groupsRepository.find({
      relations: ['roles'],
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Group> {
    const group = await this.groupsRepository.findOne({
      where: { id },
      relations: ['roles'],
    });
    if (!group) {
      throw new NotFoundException(`Group with ID ${id} not found`);
    }
    return group;
  }

  async findByName(name: string): Promise<Group | undefined> {
    return await this.groupsRepository.findOne({
      where: { name },
      relations: ['roles'],
    });
  }

  async create(
    name: string,
    description?: string,
    roleIds?: string[],
    isDefault: boolean = false,
  ): Promise<Group> {
    const existingGroup = await this.findByName(name);
    if (existingGroup) {
      throw new BadRequestException(`Group with name ${name} already exists`);
    }

    const group = this.groupsRepository.create({
      name,
      description,
      isDefault,
    });

    if (roleIds && roleIds.length > 0) {
      const roles = await Promise.all(
        roleIds.map(id => this.rolesService.findOne(id)),
      );
      group.roles = roles.filter(r => r !== undefined);
    }

    return await this.groupsRepository.save(group);
  }

  async update(
    id: string,
    updateData: {
      name?: string;
      description?: string;
      roleIds?: string[];
    },
  ): Promise<Group> {
    const group = await this.findOne(id);

    // Prevent updating default groups (except Super Admin which needs role updates)
    if (group.isDefault && group.name !== 'Super Admin') {
      throw new BadRequestException('Cannot update default groups');
    }
    
    // Prevent renaming Super Admin group
    if (group.name === 'Super Admin' && updateData.name && updateData.name !== 'Super Admin') {
      throw new BadRequestException('Cannot rename Super Admin group');
    }

    if (updateData.name !== undefined) {
      const existingGroup = await this.findByName(updateData.name);
      if (existingGroup && existingGroup.id !== id) {
        throw new BadRequestException(`Group with name ${updateData.name} already exists`);
      }
      group.name = updateData.name;
    }

    if (updateData.description !== undefined) {
      group.description = updateData.description;
    }

    if (updateData.roleIds !== undefined) {
      const roles = await Promise.all(
        updateData.roleIds.map(roleId => this.rolesService.findOne(roleId)),
      );
      group.roles = roles.filter(r => r !== undefined);
    }

    return await this.groupsRepository.save(group);
  }

  async delete(id: string): Promise<void> {
    const group = await this.findOne(id);

    // Prevent deleting default groups
    if (group.isDefault) {
      throw new BadRequestException('Cannot delete default groups');
    }

    await this.groupsRepository.remove(group);
  }

  async ensureDefaultGroupsExist(): Promise<void> {
    // Super Admin Group - assign all user, user_role, and group management roles
    let superAdminGroup = await this.findByName('Super Admin');
    if (!superAdminGroup) {
      superAdminGroup = await this.create(
        'Super Admin',
        'Super administrator with all roles. Only one user can be in this group. This group is assigned to the first user during project setup.',
        [],
        true, // isDefault
      );
    }

    // Assign all user, user_role, and group management roles to Super Admin
    const superAdminRoleNames = [
      // User Management
      Roles.USER_CREATE,
      Roles.USER_READ,
      Roles.USER_UPDATE,
      Roles.USER_DELETE,
      Roles.USER_BLOCK,
      Roles.USER_RESET_PASSWORD,
      // User Role Management
      Roles.USER_ROLE_CREATE,
      Roles.USER_ROLE_READ,
      Roles.USER_ROLE_UPDATE,
      Roles.USER_ROLE_DELETE,
      // Group Management
      Roles.GROUP_CREATE,
      Roles.GROUP_READ,
      Roles.GROUP_UPDATE,
      Roles.GROUP_DELETE,
    ];

    const superAdminRoles = (await Promise.all(
      superAdminRoleNames.map(roleName => this.rolesService.findByName(roleName)),
    )).filter((role): role is NonNullable<typeof role> => role !== undefined);

    // Only update if roles are missing
    const currentRoleNames = superAdminGroup.roles?.map(r => r.name) || [];
    const missingRoles = superAdminRoles.filter(role => !currentRoleNames.includes(role.name));
    
    if (missingRoles.length > 0) {
      superAdminGroup.roles = [...(superAdminGroup.roles || []), ...missingRoles];
      await this.groupsRepository.save(superAdminGroup);
    }

    // Admin Group
    const adminGroup = await this.findByName('Admin');
    if (!adminGroup) {
      await this.create(
        'Admin',
        'Administrator role group. Roles can be assigned to this group.',
        [],
        true, // isDefault
      );
    }

    // Librarian Group
    const librarianGroup = await this.findByName('Librarian');
    if (!librarianGroup) {
      await this.create(
        'Librarian',
        'Librarian role group. Roles can be assigned to this group.',
        [],
        true, // isDefault
      );
    }

    // User Group
    const userGroup = await this.findByName('User');
    if (!userGroup) {
      await this.create(
        'User',
        'Regular user role group. Roles can be assigned to this group.',
        [],
        true, // isDefault
      );
    }
  }
}
