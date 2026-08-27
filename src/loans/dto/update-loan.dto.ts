import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsEnum } from 'class-validator';
import { LoanStatus } from '../entities/loan.entity';

export class UpdateLoanDto {
  // See CreateLoanDto: a Date-typed property is coerced before validation and
  // then always fails @IsDateString.
  @ApiProperty({ required: false, example: '2026-02-14' })
  @IsDateString()
  @IsOptional()
  returnDate?: string;

  @ApiProperty({ enum: LoanStatus, required: false })
  @IsEnum(LoanStatus)
  @IsOptional()
  status?: LoanStatus;
}

