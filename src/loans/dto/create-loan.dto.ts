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

  // Typed as string, not Date: the global ValidationPipe runs with
  // enableImplicitConversion, which would coerce these to Date objects before
  // validation and make @IsDateString reject every request.
  @ApiProperty({ example: '2026-01-31' })
  @IsDateString()
  @IsNotEmpty()
  borrowDate: string;

  @ApiProperty({ example: '2026-02-14' })
  @IsDateString()
  @IsNotEmpty()
  dueDate: string;
}

