import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../users/entities/user.entity';
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
  ) {}

  async register(registerDto: RegisterDto): Promise<{ user: Omit<User, 'password' | 'securityAnswer'>; access_token: string }> {
    const existingUser = await this.usersRepository.findOne({ where: { email: registerDto.email } });
    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const hashedAnswer = await bcrypt.hash(registerDto.securityAnswer.toLowerCase(), 10);

    const user = this.usersRepository.create({
      name: registerDto.name,
      email: registerDto.email,
      phone: registerDto.phone,
      address: registerDto.address,
      password: hashedPassword,
      securityAnswer: hashedAnswer,
      role: registerDto.role || UserRole.USER,
      securityQuestion: registerDto.securityQuestion,
    });

    const savedUser = await this.usersRepository.save(user);
    const { password, securityAnswer, ...userWithoutSensitive } = savedUser;

    const payload = { email: user.email, sub: user.id, role: user.role };
    const access_token = this.jwtService.sign(payload);

    return {
      user: userWithoutSensitive,
      access_token,
    };
  }

  async login(loginDto: LoginDto): Promise<{ user: Omit<User, 'password' | 'securityAnswer'>; access_token: string }> {
    const user = await this.usersRepository.findOne({ where: { email: loginDto.email } });
    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { password, securityAnswer, ...userWithoutSensitive } = user;

    const payload = { email: user.email, sub: user.id, role: user.role };
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

  async validateUser(userId: number): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }
}

