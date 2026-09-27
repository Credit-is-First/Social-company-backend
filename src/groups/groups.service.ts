import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group } from './entities/group.entity';
import { Role } from '../roles/entities/role.entity';
import { RolesService } from '../roles/roles.service';
import { DEFAULT_GROUP_DEFINITIONS, SUPER_ADMIN_GROUP } from '../roles/roles.constants';
import { assertCanGrant, assertCanRevoke, diffRoleNames } from '../roles/privilege';
import { User } from '../users/entities/user.entity';

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

  /**
   * Creates a group on a caller's behalf. Its roles are held to the same rule
   * as assigning roles to a user: nobody can put a role they do not hold into
   * a group, or they could join it (or already be in it) and gain the role.
   * Only the default groups seeded at startup are `isDefault`; callers cannot
   * create undeletable groups.
   */
  async create(
    actor: User,
    data: { name: string; description?: string; roleIds?: string[] },
  ): Promise<Group> {
    const roles = data.roleIds && data.roleIds.length > 0
      ? await Promise.all(data.roleIds.map(id => this.rolesService.findOne(id)))
      : [];
    assertCanGrant(actor, roles.map(role => role.name));

    return await this.insertGroup(data.name, data.description, roles, false);
  }

  private async insertGroup(
    name: string,
    description: string | undefined,
    roles: Role[],
    isDefault: boolean,
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
    group.roles = roles;

    return await this.groupsRepository.save(group);
  }

  /**
   * Changes to a group's roles reach every member at once, so they follow the
   * privilege rule too: the caller can only add roles they hold and only remove
   * roles they hold. Without this an Admin could add `user:delete` to their own
   * group, or empty the Super Admin group. The Super Admin group's roles are
   * fixed outright — it holds every role by definition.
   */
  async update(
    actor: User,
    id: string,
    updateData: {
      name?: string;
      description?: string;
      roleIds?: string[];
    },
  ): Promise<Group> {
    const group = await this.findOne(id);

    // Default groups are identity-protected, not frozen: their whole purpose is
    // to have roles assigned to them, so only renaming is blocked.
    if (group.isDefault && updateData.name !== undefined && updateData.name !== group.name) {
      throw new BadRequestException(`Cannot rename the default "${group.name}" group`);
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
      const { added, removed } = diffRoleNames(
        (group.roles || []).map(role => role.name),
        roles.map(role => role.name),
      );

      if (group.name === SUPER_ADMIN_GROUP && (added.length > 0 || removed.length > 0)) {
        throw new ForbiddenException(`The ${SUPER_ADMIN_GROUP} group's roles are fixed: it holds every role`);
      }
      assertCanGrant(actor, added);
      assertCanRevoke(actor, removed);

      group.roles = roles;
    }

    return await this.groupsRepository.save(group);
  }

  async delete(actor: User, id: string): Promise<void> {
    const group = await this.findOne(id);

    // Prevent deleting default groups
    if (group.isDefault) {
      throw new BadRequestException('Cannot delete default groups');
    }

    // Deleting a group takes its roles away from every member.
    assertCanRevoke(actor, (group.roles || []).map(role => role.name));

    await this.groupsRepository.remove(group);
  }

  /**
   * Creates the default groups and tops up any roles they are missing.
   *
   * Only ever adds roles — an administrator who removes one from a default
   * group keeps that decision across restarts.
   */
  async ensureDefaultGroupsExist(): Promise<void> {
    // Roles must exist before groups, otherwise the role lookups below all miss
    // and the default groups are created with no permissions at all.
    await this.rolesService.ensureRolesExist();

    for (const definition of DEFAULT_GROUP_DEFINITIONS) {
      let group = await this.findByName(definition.name);

      if (!group) {
        group = await this.insertGroup(definition.name, definition.description, [], true);
      }

      const wanted = (await Promise.all(
        definition.roles.map(roleName => this.rolesService.findByName(roleName)),
      )).filter((role): role is Role => !!role);

      const currentRoleNames = (group.roles || []).map(role => role.name);
      const missingRoles = wanted.filter(role => currentRoleNames.indexOf(role.name) === -1);

      if (missingRoles.length > 0) {
        group.roles = (group.roles || []).concat(missingRoles);
        await this.groupsRepository.save(group);
      }
    }
  }
}
