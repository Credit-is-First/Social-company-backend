import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { GroupsService } from '../groups/groups.service';
import { RolesService } from '../roles/roles.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private jwtService: JwtService,
    private groupsService: GroupsService,
    private rolesService: RolesService,
  ) {}

  async register(registerDto: RegisterDto): Promise<Omit<User, 'password' | 'securityAnswer' | 'hasRole' | 'getAllRoleNames'>> {
    const existingUser = await this.usersRepository.findOne({ where: { email: registerDto.email } });
    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    // Ensure default groups exist
    await this.groupsService.ensureDefaultGroupsExist();

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const hashedAnswer = await bcrypt.hash(registerDto.securityAnswer.toLowerCase(), 10);

    // Check if this is the first user (setup) - assign super admin group
    const userCount = await this.usersRepository.count();
    const isFirstUser = userCount === 0;

    let group = null;
    if (isFirstUser) {
      // Assign super admin group to first user (setup)
      group = await this.groupsService.findByName('Super Admin');
      if (!group) {
        throw new BadRequestException('Super Admin group not found. Please ensure default groups are initialized.');
      }
    }
    // For subsequent users, they will be created without groups
    // Groups and roles can be assigned later by administrators

    const user = this.usersRepository.create({
      name: registerDto.name,
      email: registerDto.email,
      phone: registerDto.phone,
      address: registerDto.address,
      password: hashedPassword,
      securityAnswer: hashedAnswer,
      groups: group ? [group] : [],
      roles: [],
      securityQuestion: registerDto.securityQuestion,
    });

    const savedUser = await this.usersRepository.save(user);
    const { password, securityAnswer, ...userWithoutSensitive } = savedUser;

    return userWithoutSensitive;
  }

  async login(loginDto: LoginDto): Promise<{ user: Omit<User, 'password' | 'securityAnswer' | 'hasRole' | 'getAllRoleNames'>; access_token: string }> {
    const user = await this.usersRepository.findOne({ 
      where: { email: loginDto.email },
      relations: ['groups', 'groups.roles', 'roles']
    });
    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.blocked) {
      throw new UnauthorizedException('Your account has been blocked. Please contact an administrator.');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { password, securityAnswer, ...userWithoutSensitive } = user;
    const groupNames = user.groups?.map(g => g.name) || [];
    // Get all role names (direct roles + roles from groups)
    const directRoleNames = user.roles?.map(r => r.name) || [];
    const groupRoleNames = (user.groups || []).reduce<string[]>((acc, g) => {
      const roleNames = g.roles?.map(r => r.name) || [];
      return acc.concat(roleNames);
    }, []);
    const roleNames = [...new Set([...directRoleNames, ...groupRoleNames])];

    const payload = { email: user.email, sub: user.id, roles: roleNames, groups: groupNames };
    const access_token = this.jwtService.sign(payload);

    return {
      user: userWithoutSensitive,
      access_token,
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const user = await this.usersRepository.findOne({ where: { email: resetPasswordDto.email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.securityAnswer) {
      throw new BadRequestException('Security question not set');
    }

    const isAnswerValid = await bcrypt.compare(
      resetPasswordDto.securityAnswer.toLowerCase(),
      user.securityAnswer,
    );

    if (!isAnswerValid) {
      throw new UnauthorizedException('Invalid security answer');
    }

    const hashedPassword = await bcrypt.hash(resetPasswordDto.newPassword, 10);
    user.password = hashedPassword;
    await this.usersRepository.save(user);

    return { message: 'Password reset successfully' };
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.password) {
      throw new NotFoundException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(changePasswordDto.currentPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(changePasswordDto.newPassword, 10);
    user.password = hashedPassword;
    await this.usersRepository.save(user);

    return { message: 'Password changed successfully' };
  }

  async updateProfile(userId: string, updateData: { name?: string; phone?: string; address?: string }): Promise<Omit<User, 'password' | 'securityAnswer' | 'hasRole' | 'getAllRoleNames'>> {
    const user = await this.usersRepository.findOne({ 
      where: { id: userId },
      relations: ['roles']
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (updateData.name !== undefined) user.name = updateData.name;
    if (updateData.phone !== undefined) user.phone = updateData.phone;
    if (updateData.address !== undefined) user.address = updateData.address;

    const updatedUser = await this.usersRepository.save(user);
    const { password, securityAnswer, ...userWithoutSensitive } = updatedUser;
    return userWithoutSensitive;
  }

  async validateUser(userId: string): Promise<User> {
    const user = await this.usersRepository.findOne({ 
      where: { id: userId },
      relations: ['groups', 'groups.roles', 'roles']
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.blocked) {
      throw new UnauthorizedException('Your account has been blocked. Please contact an administrator.');
    }
    return user;
  }

  async setupSuperAdmin(registerDto: RegisterDto): Promise<Omit<User, 'password' | 'securityAnswer' | 'hasRole' | 'getAllRoleNames'>> {
    // Check if setup is already complete
    const userCount = await this.usersRepository.count();
    if (userCount > 0) {
      throw new BadRequestException('Setup already completed. Super admin account already exists.');
    }

    // Ensure default groups and roles exist
    await this.groupsService.ensureDefaultGroupsExist();
    await this.rolesService.ensureRolesExist();

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const hashedAnswer = await bcrypt.hash(registerDto.securityAnswer.toLowerCase(), 10);

    // Get Super Admin group
    const superAdminGroup = await this.groupsService.findByName('Super Admin');
    if (!superAdminGroup) {
      throw new BadRequestException('Super Admin group not found. Please ensure default groups are initialized.');
    }

    const user = this.usersRepository.create({
      name: registerDto.name,
      email: registerDto.email,
      phone: registerDto.phone,
      address: registerDto.address,
      password: hashedPassword,
      securityAnswer: hashedAnswer,
      groups: [superAdminGroup],
      roles: [],
      securityQuestion: registerDto.securityQuestion,
    });

    const savedUser = await this.usersRepository.save(user);
    const { password, securityAnswer, ...userWithoutSensitive } = savedUser;

    return userWithoutSensitive;
  }
}

