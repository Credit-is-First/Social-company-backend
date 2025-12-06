import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsEnum } from 'class-validator';
import { LoanStatus } from '../entities/loan.entity';

export class UpdateLoanDto {
  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  returnDate?: Date;

  @ApiProperty({ enum: LoanStatus, required: false })
  @IsEnum(LoanStatus)
  @IsOptional()
  status?: LoanStatus;
}

