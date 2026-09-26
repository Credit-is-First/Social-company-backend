import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { Role } from '../roles/entities/role.entity';
import { Group } from '../groups/entities/group.entity';
import { Roles } from '../roles/roles.constants';

/**
 * These tests pin the rule that stops privilege escalation: nobody can grant,
 * or take over an account holding, a role they do not hold themselves.
 */

function role(name: string): Role {
  return { id: `role-${name}`, name } as Role;
}

function group(name: string, roleNames: string[]): Group {
  return { id: `group-${name}`, name, roles: roleNames.map(role) } as Group;
}

function user(id: string, groups: Group[] = [], roles: Role[] = []): User {
  return Object.assign(new User(), { id, groups, roles });
}

const ADMIN_ROLES = [Roles.USER_UPDATE, Roles.USER_RESET_PASSWORD, Roles.USER_ROLE_UPDATE, Roles.BOOK_READ];

function buildService(world: { [id: string]: User }) {
  const catalogue = [
    role(Roles.BOOK_READ),
    role(Roles.USER_DELETE),
    role(Roles.USER_ROLE_UPDATE),
  ];
  const groups = [group('Librarian', [Roles.BOOK_READ]), group('Deleters', [Roles.USER_DELETE])];

  const usersRepository: any = {
    findOne: jest.fn(async (options: any) => world[options.where.id]),
    save: jest.fn(async (value: User) => value),
  };
  const refreshTokensRepository: any = { update: jest.fn(async () => undefined) };
  const rolesService: any = {
    findOne: jest.fn(async (id: string) => catalogue.find(r => r.id === id)),
  };
  const groupsService: any = {
    findOne: jest.fn(async (id: string) => groups.find(g => g.id === id)),
  };

  const service = new UsersService(
    usersRepository,
    {} as any,
    refreshTokensRepository,
    rolesService,
    groupsService,
  );
  return { service, refreshTokensRepository, usersRepository };
}

describe('UsersService privilege containment', () => {
  const admin = user('admin', [group('Admin', ADMIN_ROLES)]);
  const superAdmin = user('super', [group('Super Admin', [...ADMIN_ROLES, Roles.USER_DELETE])]);

  describe('updateUserRoles', () => {
    it('refuses to let an admin grant themselves a role they lack', async () => {
      const { service } = buildService({ admin });

      await expect(
        service.updateUserRoles(admin, 'admin', [`role-${Roles.USER_DELETE}`]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows granting a role the caller holds', async () => {
      const member = user('member');
      const { service } = buildService({ member });

      const saved = await service.updateUserRoles(admin, 'member', [`role-${Roles.BOOK_READ}`]);

      expect(saved.roles.map(r => r.name)).toEqual([Roles.BOOK_READ]);
    });

    it('allows keeping a role the caller lacks that the target already has', async () => {
      const member = user('member', [], [role(Roles.USER_DELETE)]);
      const { service } = buildService({ member });

      const saved = await service.updateUserRoles(admin, 'member', [
        `role-${Roles.USER_DELETE}`,
        `role-${Roles.BOOK_READ}`,
      ]);

      expect(saved.roles).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('applies the same rule to roleIds sent to PATCH /users/:id', async () => {
      const { service } = buildService({ admin });

      await expect(
        service.update(admin, 'admin', { roleIds: [`role-${Roles.USER_DELETE}`] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires user_role:update to change roles at all', async () => {
      const editor = user('editor', [group('Editors', [Roles.USER_UPDATE])]);
      const member = user('member');
      const { service } = buildService({ member });

      await expect(
        service.update(editor, 'member', { roleIds: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('updateUserGroups', () => {
    it('refuses a group carrying roles the caller lacks', async () => {
      const member = user('member');
      const { service } = buildService({ member });

      await expect(
        service.updateUserGroups(admin, 'member', ['group-Deleters']),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a group whose roles the caller holds', async () => {
      const member = user('member');
      const { service } = buildService({ member });

      const saved = await service.updateUserGroups(admin, 'member', ['group-Librarian']);

      expect(saved.groups.map(g => g.name)).toEqual(['Librarian']);
    });
  });

  describe('resetUserPassword', () => {
    it('refuses to let an admin reset the super admin password', async () => {
      const { service, usersRepository, refreshTokensRepository } = buildService({ super: superAdmin });

      await expect(
        service.resetUserPassword(admin, 'super', 'new-password-123'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(usersRepository.save).not.toHaveBeenCalled();
      expect(refreshTokensRepository.update).not.toHaveBeenCalled();
    });

    it('resets a less privileged account and revokes its sessions', async () => {
      const member = user('member', [group('User', [Roles.BOOK_READ])]);
      const { service, refreshTokensRepository } = buildService({ member });

      await service.resetUserPassword(admin, 'member', 'new-password-123');

      expect(member.password).toBeDefined();
      expect(refreshTokensRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'member' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('lets the super admin reset anyone', async () => {
      const { service } = buildService({ admin });

      await expect(service.resetUserPassword(superAdmin, 'admin', 'new-password-123')).resolves.toBeDefined();
    });
  });
});
