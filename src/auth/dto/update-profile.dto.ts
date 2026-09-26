import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsNotEmpty, MaxLength, IsEnum, Matches } from 'class-validator';
import { Gender } from '../../users/entities/user.entity';

export class UpdateProfileDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  // A plain string rather than Date: the global pipe runs with
  // enableImplicitConversion, which would coerce it before validation.
  @ApiProperty({ required: false, example: '1990-05-21' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be in YYYY-MM-DD format' })
  dateOfBirth?: string;

  @ApiProperty({ required: false, enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  occupation?: string;
}
