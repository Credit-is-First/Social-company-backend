import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsString, IsEnum, IsIn, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { BookStatus } from '../entities/book.entity';

export const BOOK_SORT_FIELDS = [
  'title',
  'author',
  'isbn',
  'category',
  'status',
  'createdAt',
  'updatedAt',
  'totalCopies',
  'availableCopies',
];

export type BookSortOrder = 'ASC' | 'DESC';

/** Filters shared by the list and CSV-export endpoints. */
export class BookFilterDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiProperty({ required: false, enum: BookStatus })
  @IsOptional()
  @IsEnum(BookStatus)
  status?: BookStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  author?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  isbn?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  category?: string;
}

export class PaginationDto extends BookFilterDto {
  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ required: false, default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiProperty({ required: false, enum: BOOK_SORT_FIELDS })
  @IsOptional()
  @IsIn(BOOK_SORT_FIELDS)
  sortBy?: string;

  // Interpolated into the ORDER BY clause by TypeORM, so it must be one of
  // exactly two literals — never free-form input.
  @ApiProperty({ required: false, enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: BookSortOrder = 'DESC';
}
