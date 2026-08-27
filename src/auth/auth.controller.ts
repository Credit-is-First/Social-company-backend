import {
  Controller,
  Post,
  Body,
  UseGuards,
  Patch,
  Get,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService, AuthSession } from './auth.service';
import { setRefreshCookie, clearRefreshCookie, readRefreshCookie } from './refresh-cookie';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SecurityQuestionQueryDto } from './dto/security-question-query.dto';
import { Public } from './decorators/public.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

const MINUTE = 60 * 1000;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Puts the refresh token in an httpOnly cookie and returns only what the page
   * legitimately needs to hold in memory.
   */
  private respondWithSession(session: AuthSession, response: Response) {
    setRefreshCookie(response, session.refreshToken, session.refreshExpiresAt);
    return {
      user: session.user,
      access_token: session.accessToken,
    };
  }

  @Public()
  @Get('check-setup')
  @ApiOperation({ summary: 'Check if setup is needed (public endpoint)' })
  @ApiResponse({ status: 200, description: 'Returns true if no users exist' })
  async checkSetup() {
    const count = await this.usersService.count();
    return { needsSetup: count === 0 };
  }

  @Public()
  @RateLimit({ limit: 5, windowMs: 60 * MINUTE })
  @Post('setup-super-admin')
  @ApiOperation({ summary: 'Setup super admin account (public endpoint, only works if no users exist)' })
  @ApiResponse({ status: 201, description: 'Super admin account created successfully' })
  @ApiResponse({ status: 400, description: 'Setup already completed or email already exists' })
  setupSuperAdmin(@Body() registerDto: RegisterDto) {
    return this.authService.setupSuperAdmin(registerDto);
  }

  @Public()
  @RateLimit({ limit: 10, windowMs: 60 * MINUTE })
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Email already exists' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @RateLimit({ limit: 10, windowMs: 5 * MINUTE })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many attempts' })
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.authService.login(loginDto);
    return this.respondWithSession(session, response);
  }

  @Public()
  @RateLimit({ limit: 30, windowMs: 5 * MINUTE })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange the refresh cookie for a new session (rotates the cookie)',
  })
  @ApiResponse({ status: 200, description: 'New access token; the refresh cookie is replaced' })
  @ApiResponse({ status: 401, description: 'Refresh cookie missing, invalid, expired or already used' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = readRefreshCookie(request);
    if (!token) {
      throw new UnauthorizedException('No refresh token');
    }

    try {
      const session = await this.authService.refreshSession(token);
      return this.respondWithSession(session, response);
    } catch (error) {
      // The cookie is unusable from here on; drop it so the browser stops
      // sending a token that will only ever be rejected.
      clearRefreshCookie(response);
      throw error;
    }
  }

  // Public so that an expired access token does not prevent signing out.
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the refresh token and clear its cookie' })
  @ApiResponse({ status: 200, description: 'Signed out' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = readRefreshCookie(request);
    clearRefreshCookie(response);
    return await this.authService.logout(token);
  }

  /**
   * Answering a security question requires seeing it. This does confirm whether
   * an address is registered, which is inherent to the mechanism — the tight
   * rate limit is what keeps it from being a usable enumeration oracle.
   */
  @Public()
  @RateLimit({ limit: 10, windowMs: 15 * MINUTE })
  @Get('security-question')
  @ApiOperation({ summary: 'Look up the security question for an email address' })
  @ApiResponse({ status: 200, description: 'The security question' })
  @ApiResponse({ status: 404, description: 'No security question set for that address' })
  getSecurityQuestion(@Query() query: SecurityQuestionQueryDto) {
    return this.authService.getSecurityQuestion(query.email);
  }

  @Public()
  @RateLimit({ limit: 5, windowMs: 15 * MINUTE })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using security question' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 401, description: 'Invalid security answer' })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch('change-password')
  @ApiOperation({ summary: 'Change password (requires authentication)' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect' })
  async changePassword(
    @CurrentUser() user: User,
    @Body() changePasswordDto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.changePassword(user.id, changePasswordDto);
    setRefreshCookie(response, result.refresh.token, result.refresh.expiresAt);
    return { message: result.message };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile' })
  getProfile(@CurrentUser() user: User) {
    // Returned as the entity so @Exclude() decides what is visible.
    return user;
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch('profile')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  async updateProfile(@CurrentUser() user: User, @Body() updateData: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, updateData);
  }
}
