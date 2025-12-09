import { PartialType } from '@nestjs/swagger';
import { IsArray, IsUUID, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiProperty({ type: [String], required: false })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  roleIds?: string[];
}

