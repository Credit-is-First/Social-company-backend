import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for the decline and deprecate actions. */
export class BookReasonDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
