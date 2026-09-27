import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { Group } from './entities/group.entity';
import { Role } from '../roles/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { Roles, SUPER_ADMIN_GROUP } from '../roles/roles.constants';

/**
 * Editing a group changes the roles of everyone in it, so group edits follow
 * the same privilege rule as user edits: nobody can add or remove a role they
 * do not hold. This closes the path where an Admin with group:update added
 * user:delete to their own group, or emptied the Super Admin group.
 */

function role(name: string): Role {
  return { id: `role-${name}`, name } as Role;
}

function group(name: string, roleNames: string[], extra: Partial<Group> = {}): Group {
  return Object.assign({ id: `group-${name}`, name, roles: roleNames.map(role), isDefault: false }, extra) as Group;
}

function actorWith(roleNames: string[]): User {
  return Object.assign(new User(), { id: 'actor', roles: [], groups: [group('Mine', roleNames)] });
}

const ADMIN_ROLES: string[] = [Roles.GROUP_CREATE, Roles.GROUP_UPDATE, Roles.GROUP_DELETE, Roles.BOOK_READ, Roles.BOOK_CREATE];

function buildService(groups: Group[]) {
  const catalogue = [
    Roles.BOOK_READ, Roles.BOOK_CREATE, Roles.USER_DELETE,
    Roles.GROUP_CREATE, Roles.GROUP_UPDATE, Roles.GROUP_DELETE,
  ].map(role);

  const groupsRepository: any = {
    findOne: jest.fn(async (options: any) => {
      const where = options.where;
      return groups.find(g => (where.id ? g.id === where.id : g.name === where.name));
    }),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (value: Group) => value),
    remove: jest.fn(async (value: Group) => value),
  };
  const rolesService: any = {
    findOne: jest.fn(async (id: string) => {
      const found = catalogue.find(r => r.id === id);
      if (!found) throw new NotFoundException(id); // as RolesService does
      return found;
    }),
  };

  return { service: new GroupsService(groupsRepository, rolesService), groupsRepository };
}

describe('GroupsService privilege containment', () => {
  const admin = actorWith(ADMIN_ROLES);

  describe('update', () => {
    it('refuses adding a role the caller does not hold, even to their own group', async () => {
      const adminGroup = group('Admin', ADMIN_ROLES, { isDefault: true });
      const { service } = buildService([adminGroup]);

      await expect(
        service.update(admin, 'group-Admin', {
          roleIds: ADMIN_ROLES.concat([Roles.USER_DELETE]).map(name => `role-${name}`),
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses removing a role the caller does not hold', async () => {
      const deleters = group('Deleters', [Roles.USER_DELETE, Roles.BOOK_READ]);
      const { service } = buildService([deleters]);

      await expect(
        service.update(admin, 'group-Deleters', { roleIds: [`role-${Roles.BOOK_READ}`] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses any change to the Super Admin group roles, even by the Super Admin', async () => {
      const everyRole = [Roles.BOOK_READ, Roles.BOOK_CREATE, Roles.USER_DELETE, Roles.GROUP_UPDATE];
      const superAdminGroup = group(SUPER_ADMIN_GROUP, everyRole, { isDefault: true });
      const superAdmin = actorWith(everyRole);
      const { service } = buildService([superAdminGroup]);

      await expect(service.update(superAdmin, `group-${SUPER_ADMIN_GROUP}`, { roleIds: [] })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('allows adding and removing roles the caller holds', async () => {
      const librarian = group('Librarian', [Roles.BOOK_READ]);
      const { service } = buildService([librarian]);

      const saved = await service.update(admin, 'group-Librarian', { roleIds: [`role-${Roles.BOOK_CREATE}`] });

      expect(saved.roles.map(r => r.name)).toEqual([Roles.BOOK_CREATE]);
    });

    it('allows renaming a group that carries roles the caller lacks, if its roles are untouched', async () => {
      const deleters = group('Deleters', [Roles.USER_DELETE]);
      const { service } = buildService([deleters]);

      const saved = await service.update(admin, 'group-Deleters', { description: 'Can delete accounts' });

      expect(saved.description).toBe('Can delete accounts');
    });
  });

  describe('create', () => {
    it('refuses a new group carrying a role the caller does not hold', async () => {
      const { service } = buildService([]);

      await expect(
        service.create(admin, { name: 'Escalate', roleIds: [`role-${Roles.USER_DELETE}`] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('creates groups that are never default, so they stay deletable', async () => {
      const { service } = buildService([]);

      const created = await service.create(admin, { name: 'Readers', roleIds: [`role-${Roles.BOOK_READ}`] });

      expect(created.isDefault).toBe(false);
    });
  });

  describe('startup seeding', () => {
    it('still creates the default groups with no caller', async () => {
      const { service, groupsRepository } = buildService([]);
      (service as any).rolesService.ensureRolesExist = jest.fn(async () => undefined);
      (service as any).rolesService.findByName = jest.fn(async () => undefined);

      await service.ensureDefaultGroupsExist();

      const created = groupsRepository.save.mock.calls.map((c: any[]) => c[0]);
      expect(created.map((g: Group) => g.name)).toContain(SUPER_ADMIN_GROUP);
      expect(created.every((g: Group) => g.isDefault)).toBe(true);
    });
  });

  describe('delete', () => {
    it('refuses deleting a group whose roles the caller does not hold', async () => {
      const deleters = group('Deleters', [Roles.USER_DELETE]);
      const { service, groupsRepository } = buildService([deleters]);

      await expect(service.delete(admin, 'group-Deleters')).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupsRepository.remove).not.toHaveBeenCalled();
    });

    it('still refuses deleting a default group', async () => {
      const userGroup = group('User', [Roles.BOOK_READ], { isDefault: true });
      const { service } = buildService([userGroup]);

      await expect(service.delete(admin, 'group-User')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
