import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ResetUserPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  newPassword: string;
}
