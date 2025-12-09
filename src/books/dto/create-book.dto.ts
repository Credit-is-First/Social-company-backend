import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsInt, IsOptional, IsBoolean, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateBookDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  author: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  isbn: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty()
  @Transform(({ value }) => {
    const num = parseInt(value, 10);
    return isNaN(num) ? value : num;
  })
  @IsInt()
  @IsNotEmpty()
  totalCopies: number;

  @ApiProperty({ required: false })
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    return value;
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    // HTML date input returns YYYY-MM-DD format
    // Convert to ISO 8601 format (YYYY-MM-DD is already valid ISO 8601 date format)
    if (typeof value === 'string' && value.length > 0) {
      // Validate it's in YYYY-MM-DD format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateRegex.test(value)) {
        return value;
      }
    }
    return undefined;
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'publishedDate must be in YYYY-MM-DD format' })
  @IsOptional()
  publishedDate?: string;

  @ApiProperty({ required: false, default: false })
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  isEbook?: boolean;
}

