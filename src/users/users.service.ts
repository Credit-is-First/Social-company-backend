import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { Loan } from '../loans/entities/loan.entity';
import { Role } from '../roles/entities/role.entity';
import { Group } from '../groups/entities/group.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { RolesService } from '../roles/roles.service';
import { GroupsService } from '../groups/groups.service';
import { SUPER_ADMIN_GROUP, DEFAULT_MEMBER_GROUP, Roles } from '../roles/roles.constants';
import { assertCanGrant, assertCanRevoke, assertCanActAs, diffRoleNames } from '../roles/privilege';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Loan)
    private loansRepository: Repository<Loan>,
    @InjectRepository(RefreshToken)
    private refreshTokensRepository: Repository<RefreshToken>,
    private rolesService: RolesService,
    private groupsService: GroupsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lockout protection
  // ---------------------------------------------------------------------------

  private isSuperAdmin(user: User): boolean {
    return (user.groups || []).some(group => group.name === SUPER_ADMIN_GROUP);
  }

  /**
   * The Super Admin group is capped at one member, so any action that would
   * remove or disable that member leaves the installation with nobody able to
   * administer it.
   */
  private assertNotLastSuperAdmin(user: User, action: string): void {
    if (this.isSuperAdmin(user)) {
      throw new BadRequestException(
        `Cannot ${action} the Super Admin account — doing so would leave the system with no administrator. ` +
          `Transfer the Super Admin role to another user first (POST /users/:id/transfer-super-admin).`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Privilege containment (rules in ../roles/privilege.ts)
  // ---------------------------------------------------------------------------

  /** Every role name a user would hold with these direct roles and groups. */
  private effectiveRoleNames(roles: Role[], groups: Group[]): string[] {
    const names = new Set<string>();
    roles.forEach(role => names.add(role.name));
    groups.forEach(group => (group.roles || []).forEach(role => names.add(role.name)));
    return Array.from(names);
  }

  /**
   * Checks a change to a user's roles or groups by what they would actually
   * gain and lose, not by which groups were ticked: adding a group whose roles
   * the user already holds grants nothing, and dropping a group can revoke roles.
   */
  private assertCanChangeRoles(actor: User, before: string[], after: string[]): void {
    const { added, removed } = diffRoleNames(before, after);
    assertCanGrant(actor, added);
    assertCanRevoke(actor, removed);
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async create(actor: User, createUserDto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepository.findOne({ where: { email: createUserDto.email } });
    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const roles = createUserDto.roleIds
      ? await Promise.all(createUserDto.roleIds.map(roleId => this.rolesService.findOne(roleId)))
      : [];

    let groups = createUserDto.groupIds
      ? await Promise.all(createUserDto.groupIds.map(groupId => this.groupsService.findOne(groupId)))
      : [];

    // An account with no group cannot do anything, so fall back to the default
    // member group rather than creating a dead account.
    if (groups.length === 0) {
      const defaultGroup = await this.groupsService.findByName(DEFAULT_MEMBER_GROUP);
      groups = defaultGroup ? [defaultGroup] : [];
    }

    if (groups.some(group => group.name === SUPER_ADMIN_GROUP)) {
      throw new BadRequestException(
        `New accounts cannot be placed in the ${SUPER_ADMIN_GROUP} group. Transfer it from the current holder instead.`,
      );
    }

    assertCanGrant(actor, this.effectiveRoleNames(roles, groups));

    const user = this.usersRepository.create({
      name: createUserDto.name,
      email: createUserDto.email,
      phone: createUserDto.phone,
      address: createUserDto.address,
      password: await bcrypt.hash(createUserDto.password, BCRYPT_ROUNDS),
      roles,
      groups,
    });

    return await this.usersRepository.save(user);
  }

  async update(actor: User, id: string, updateUserDto: UpdateUserDto): Promise<User> {
    // Personal data (name, email, phone, address) is ignored here; members
    // update it themselves via /auth/profile. Roles are the only thing this
    // endpoint changes, so it is held to the same rules as PATCH /users/:id/roles.
    if (updateUserDto.roleIds && Array.isArray(updateUserDto.roleIds)) {
      if (!actor.hasRole(Roles.USER_ROLE_UPDATE)) {
        throw new ForbiddenException(`Changing roles requires the ${Roles.USER_ROLE_UPDATE} role`);
      }
      return await this.updateUserRoles(actor, id, updateUserDto.roleIds);
    }

    return await this.findOne(id);
  }

  async updateUserRoles(actor: User, userId: string, roleIds: string[]): Promise<User> {
    const user = await this.findOne(userId);
    const roles = await Promise.all(
      roleIds.map(roleId => this.rolesService.findOne(roleId))
    );

    this.assertCanChangeRoles(
      actor,
      user.getAllRoleNames(),
      this.effectiveRoleNames(roles, user.groups || []),
    );

    user.roles = roles;
    return await this.usersRepository.save(user);
  }

  async updateUserGroups(actor: User, userId: string, groupIds: string[]): Promise<User> {
    const user = await this.findOne(userId);
    const groups = await Promise.all(
      groupIds.map(groupId => this.groupsService.findOne(groupId))
    );

    const keepsSuperAdmin = groups.some(group => group.name === SUPER_ADMIN_GROUP);

    // Removing the sole Super Admin from their group locks everyone out.
    if (this.isSuperAdmin(user) && !keepsSuperAdmin) {
      throw new BadRequestException(
        `Cannot remove the ${SUPER_ADMIN_GROUP} group from its only member. ` +
          `Transfer it instead (POST /users/:id/transfer-super-admin).`,
      );
    }

    // Check if trying to assign Super Admin group
    if (keepsSuperAdmin) {
      // Check if any other user already has Super Admin group
      const existingSuperAdmin = await this.usersRepository
        .createQueryBuilder('user')
        .innerJoin('user.groups', 'group')
        .where('group.name = :groupName', { groupName: SUPER_ADMIN_GROUP })
        .andWhere('user.id != :userId', { userId })
        .getOne();

      if (existingSuperAdmin) {
        throw new BadRequestException(
          `The ${SUPER_ADMIN_GROUP} group can only have one member. ` +
            `Its current holder can transfer it (POST /users/:id/transfer-super-admin).`,
        );
      }
    }

    this.assertCanChangeRoles(
      actor,
      user.getAllRoleNames(),
      this.effectiveRoleNames(user.roles || [], groups),
    );

    user.groups = groups;
    return await this.usersRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);

    this.assertNotLastSuperAdmin(user, 'delete');

    // Loans hold a foreign key to the user; removing the row underneath them
    // used to surface as an unhandled driver error.
    const loanCount = await this.loansRepository.count({ where: { userId: id } });
    if (loanCount > 0) {
      throw new BadRequestException(
        `Cannot delete this user: they have ${loanCount} loan ${loanCount === 1 ? 'record' : 'records'}. Block the account instead.`,
      );
    }

    await this.usersRepository.remove(user);
  }

  async blockUser(userId: string, blocked: boolean): Promise<User> {
    const user = await this.findOne(userId);

    if (blocked) {
      this.assertNotLastSuperAdmin(user, 'block');
    }

    user.blocked = blocked;
    return await this.usersRepository.save(user);
  }

  /**
   * Hands the Super Admin group from its current holder (the caller) to another
   * user in one save, so there is never a moment with none or two. The group is
   * capped at one member, so this is the only way it can change hands.
   */
  async transferSuperAdmin(actor: User, targetId: string): Promise<User> {
    if (!this.isSuperAdmin(actor)) {
      throw new ForbiddenException(`Only the current ${SUPER_ADMIN_GROUP} can transfer the role`);
    }
    if (actor.id === targetId) {
      throw new BadRequestException(`You already hold the ${SUPER_ADMIN_GROUP} role`);
    }

    const holder = await this.findOne(actor.id);
    const target = await this.findOne(targetId);
    if (target.blocked) {
      throw new BadRequestException(`Cannot transfer the ${SUPER_ADMIN_GROUP} role to a blocked account`);
    }

    const superAdminGroup = (holder.groups || []).find(group => group.name === SUPER_ADMIN_GROUP);
    holder.groups = (holder.groups || []).filter(group => group.name !== SUPER_ADMIN_GROUP);
    target.groups = (target.groups || []).concat([superAdminGroup]);

    // One save of both entities runs in a single transaction.
    await this.usersRepository.save([holder, target]);

    // The old holder's sessions carry no roles (they are re-read per request),
    // so the change takes effect on their next request without revocation.
    return await this.findOne(targetId);
  }

  async resetUserPassword(actor: User, userId: string, newPassword: string): Promise<User> {
    // The admin reset needs no current password, so using it on yourself would
    // let a stolen session change the password without knowing the old one.
    if (actor.id === userId) {
      throw new ForbiddenException('Use Change Password to change your own password; it asks for your current one.');
    }

    const user = await this.findOne(userId);
    assertCanActAs(actor, user);

    user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const saved = await this.usersRepository.save(user);

    // Whoever knew the old password may still hold a session; end them all,
    // exactly as a self-service password change does.
    await this.refreshTokensRepository.update(
      { userId: user.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    return saved;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

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
}
