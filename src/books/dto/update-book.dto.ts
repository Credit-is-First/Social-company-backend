import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { CreateBookDto } from './create-book.dto';

export class UpdateBookDto extends PartialType(CreateBookDto) {
  /**
   * Declared here rather than as an inline intersection type on the controller
   * parameter: TypeScript erases intersections to `Object`, which makes Nest's
   * ValidationPipe skip the body entirely.
   */
  @ApiProperty({ required: false })
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return value === 'true' || value === true;
  })
  @IsBoolean()
  @IsOptional()
  requestReview?: boolean;
}
