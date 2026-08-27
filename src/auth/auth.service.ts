import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { classToPlain } from 'class-transformer';
import { User } from '../users/entities/user.entity';
import { GroupsService } from '../groups/groups.service';
import { SUPER_ADMIN_GROUP, DEFAULT_MEMBER_GROUP } from '../roles/roles.constants';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RefreshTokenService } from './refresh-token.service';

/**
 * The internal shape of a freshly minted session.
 *
 * The refresh token never reaches the response body — the controller puts it in
 * an httpOnly cookie, so page script cannot read it even if the page is XSSed.
 */
export interface AuthSession {
  user: Record<string, any>;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private jwtService: JwtService,
    private groupsService: GroupsService,
    private refreshTokenService: RefreshTokenService,
  ) {}

  /** Direct roles plus every role inherited from the user's groups. */
  private roleNamesFor(user: User): string[] {
    const directRoleNames = user.roles?.map(r => r.name) || [];
    const groupRoleNames = (user.groups || []).reduce<string[]>((acc, g) => {
      return acc.concat(g.roles?.map(r => r.name) || []);
    }, []);
    return Array.from(new Set(directRoleNames.concat(groupRoleNames)));
  }

  /** Builds the access token + a freshly rotated refresh token for a user. */
  private async issueSession(user: User): Promise<AuthSession> {
    const payload = {
      email: user.email,
      sub: user.id,
      roles: this.roleNamesFor(user),
      groups: (user.groups || []).map(g => g.name),
    };

    const refresh = await this.refreshTokenService.issue(user.id);

    return {
      user: classToPlain(user),
      accessToken: this.jwtService.sign(payload),
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  // These methods return the User entity itself. Secrets are stripped centrally
  // by the @Exclude() decorators plus the global ClassSerializerInterceptor;
  // hand-destructuring here used to miss securityQuestion.
  async register(registerDto: RegisterDto): Promise<User> {
    const existingUser = await this.usersRepository.findOne({ where: { email: registerDto.email } });
    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    // Ensure default groups exist
    await this.groupsService.ensureDefaultGroupsExist();

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const hashedAnswer = await bcrypt.hash(registerDto.securityAnswer.toLowerCase(), 10);

    // The very first account bootstraps the system as super admin; everyone
    // else lands in the default member group, which carries the permission to
    // request loans. Previously they were created with no group at all and so
    // could not do anything until an administrator intervened.
    const userCount = await this.usersRepository.count();
    const isFirstUser = userCount === 0;
    const groupName = isFirstUser ? SUPER_ADMIN_GROUP : DEFAULT_MEMBER_GROUP;

    const group = await this.groupsService.findByName(groupName);
    if (!group) {
      throw new BadRequestException(
        `${groupName} group not found. Please ensure default groups are initialized.`,
      );
    }

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

    return await this.usersRepository.save(user);
  }

  async login(loginDto: LoginDto): Promise<AuthSession> {
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

    // Cheap housekeeping on a naturally infrequent operation.
    await this.refreshTokenService.purgeExpired();

    return await this.issueSession(user);
  }

  /**
   * Exchanges a refresh token for a new session. The presented token is
   * consumed, so each one works exactly once.
   */
  async refreshSession(refreshToken: string): Promise<AuthSession> {
    const userId = await this.refreshTokenService.consume(refreshToken);

    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['groups', 'groups.roles', 'roles'],
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.blocked) {
      // Revoke the family too, so a blocked account cannot keep cycling tokens.
      await this.refreshTokenService.revokeAllForUser(user.id);
      throw new UnauthorizedException('Your account has been blocked. Please contact an administrator.');
    }

    return await this.issueSession(user);
  }

  async logout(refreshToken: string): Promise<{ message: string }> {
    await this.refreshTokenService.revoke(refreshToken);
    return { message: 'Signed out successfully' };
  }

  /** The security question is needed to answer it, so it is readable by email. */
  async getSecurityQuestion(email: string): Promise<{ securityQuestion: string }> {
    const user = await this.usersRepository.findOne({ where: { email } });

    if (!user || !user.securityQuestion) {
      throw new NotFoundException('No security question is set for that email address');
    }

    return { securityQuestion: user.securityQuestion };
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

    // Any session established with the old password is no longer trustworthy.
    await this.refreshTokenService.revokeAllForUser(user.id);

    return { message: 'Password reset successfully' };
  }

  /**
   * Returns a replacement refresh token alongside the confirmation: every
   * existing session is revoked, then the caller's own device is re-issued one
   * so changing your password signs out your *other* devices, not this one.
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string; refresh: { token: string; expiresAt: Date } }> {
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

    await this.refreshTokenService.revokeAllForUser(user.id);
    const refresh = await this.refreshTokenService.issue(user.id);

    return { message: 'Password changed successfully', refresh };
  }

  async updateProfile(userId: string, updateData: { name?: string; phone?: string; address?: string }): Promise<User> {
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

    return await this.usersRepository.save(user);
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

  async setupSuperAdmin(registerDto: RegisterDto): Promise<User> {
    // Check if setup is already complete
    const userCount = await this.usersRepository.count();
    if (userCount > 0) {
      throw new BadRequestException('Setup already completed. Super admin account already exists.');
    }

    // Seeds roles first, then the default groups that reference them.
    await this.groupsService.ensureDefaultGroupsExist();

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const hashedAnswer = await bcrypt.hash(registerDto.securityAnswer.toLowerCase(), 10);

    // Get Super Admin group
    const superAdminGroup = await this.groupsService.findByName(SUPER_ADMIN_GROUP);
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

    return await this.usersRepository.save(user);
  }
}

