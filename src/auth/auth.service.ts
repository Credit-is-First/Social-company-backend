import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../users/entities/user.entity';
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
    private rolesService: RolesService,
  ) {}

  async register(registerDto: RegisterDto): Promise<{ user: Omit<User, 'password' | 'securityAnswer' | 'hasRole' | 'getRoleNames'>; access_token: string }> {
    const existingUser = await this.usersRepository.findOne({ where: { email: registerDto.email } });
    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    // Ensure default roles exist
    await this.rolesService.ensureRolesExist();

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const hashedAnswer = await bcrypt.hash(registerDto.securityAnswer.toLowerCase(), 10);

    // Get default role or specified role
    const roleName = registerDto.role || UserRole.USER;
    const defaultRole = await this.rolesService.findByName(roleName);
    if (!defaultRole) {
      throw new BadRequestException(`Role ${roleName} not found`);
    }

    const user = this.usersRepository.create({
      name: registerDto.name,
      email: registerDto.email,
      phone: registerDto.phone,
      address: registerDto.address,
      password: hashedPassword,
      securityAnswer: hashedAnswer,
      roles: [defaultRole],
      securityQuestion: registerDto.securityQuestion,
    });

    const savedUser = await this.usersRepository.save(user);
    const { password, securityAnswer, ...userWithoutSensitive } = savedUser;

    // Load roles for JWT payload
    const userWithRoles = await this.usersRepository.findOne(savedUser.id, { relations: ['roles'] });
    const roleNames = userWithRoles?.roles?.map(r => r.name) || [];

    const payload = { email: user.email, sub: user.id, roles: roleNames };
    const access_token = this.jwtService.sign(payload);

    return {
      user: userWithoutSensitive,
      access_token,
    };
  }

  async login(loginDto: LoginDto): Promise<{ user: Omit<User, 'password' | 'securityAnswer' | 'hasRole' | 'getRoleNames'>; access_token: string }> {
    const user = await this.usersRepository.findOne({ 
      where: { email: loginDto.email },
      relations: ['roles']
    });
    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { password, securityAnswer, ...userWithoutSensitive } = user;
    const roleNames = user.roles?.map(r => r.name) || [];

    const payload = { email: user.email, sub: user.id, roles: roleNames };
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

  async changePassword(userId: number, changePasswordDto: ChangePasswordDto): Promise<{ message: string }> {
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

  async updateProfile(userId: number, updateData: { name?: string; phone?: string; address?: string }): Promise<Omit<User, 'password' | 'securityAnswer' | 'hasRole' | 'getRoleNames'>> {
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

  async validateUser(userId: number): Promise<User> {
    const user = await this.usersRepository.findOne({ 
      where: { id: userId },
      relations: ['roles']
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }
}

