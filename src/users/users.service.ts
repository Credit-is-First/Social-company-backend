import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { Loan } from '../loans/entities/loan.entity';
import { RolesService } from '../roles/roles.service';
import { GroupsService } from '../groups/groups.service';
import { SUPER_ADMIN_GROUP, DEFAULT_MEMBER_GROUP } from '../roles/roles.constants';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Loan)
    private loansRepository: Repository<Loan>,
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
          `Move the Super Admin group to another user first.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async create(createUserDto: CreateUserDto): Promise<User> {
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

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    // Only allow role updates through this endpoint
    // Personal data (name, email, phone, address) should only be updated by users themselves via /auth/profile
    if (updateUserDto.roleIds && Array.isArray(updateUserDto.roleIds)) {
      const roles = await Promise.all(
        updateUserDto.roleIds.map(roleId => this.rolesService.findOne(roleId))
      );
      user.roles = roles;
    }

    // Ignore personal data fields - they should only be updated by the user themselves
    // Personal data (name, email, phone, address) is ignored here

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

    const keepsSuperAdmin = groups.some(group => group.name === SUPER_ADMIN_GROUP);

    // Removing the sole Super Admin from their group locks everyone out.
    if (this.isSuperAdmin(user) && !keepsSuperAdmin) {
      throw new BadRequestException(
        `Cannot remove the ${SUPER_ADMIN_GROUP} group from its only member. Assign it to another user first.`,
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
        throw new BadRequestException('Super Admin group can only have one member');
      }
    }

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

  async resetUserPassword(userId: string, newPassword: string): Promise<User> {
    const user = await this.findOne(userId);
    user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    return await this.usersRepository.save(user);
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
