import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class SecurityQuestionQueryDto {
  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
