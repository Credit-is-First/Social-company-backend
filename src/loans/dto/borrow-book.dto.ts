import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty } from 'class-validator';

export class BorrowBookDto {
  @ApiProperty()
  @IsUUID('4')
  @IsNotEmpty()
  bookId: string;
}
