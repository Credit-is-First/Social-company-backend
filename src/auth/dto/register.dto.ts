import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEmail, IsOptional } from 'class-validator';

export class RegisterDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  securityQuestion: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  securityAnswer: string;
}

