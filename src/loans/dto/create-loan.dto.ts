import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsDateString } from 'class-validator';

export class CreateLoanDto {
  @ApiProperty()
  @IsUUID('4')
  @IsNotEmpty()
  bookId: string;

  @ApiProperty()
  @IsUUID('4')
  @IsNotEmpty()
  userId: string;

  @ApiProperty()
  @IsDateString()
  @IsNotEmpty()
  borrowDate: Date;

  @ApiProperty()
  @IsDateString()
  @IsNotEmpty()
  dueDate: Date;
}

