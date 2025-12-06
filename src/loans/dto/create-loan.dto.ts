import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsDateString } from 'class-validator';

export class CreateLoanDto {
  @ApiProperty()
  @IsInt()
  @IsNotEmpty()
  bookId: number;

  @ApiProperty()
  @IsInt()
  @IsNotEmpty()
  userId: number;

  @ApiProperty()
  @IsDateString()
  @IsNotEmpty()
  borrowDate: Date;

  @ApiProperty()
  @IsDateString()
  @IsNotEmpty()
  dueDate: Date;
}

