import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BooksModule } from './books/books.module';
import { UsersModule } from './users/users.module';
import { LoansModule } from './loans/loans.module';
import { Book } from './books/entities/book.entity';
import { User } from './users/entities/user.entity';
import { Loan } from './loans/entities/loan.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      username: 'root',
      password: '',
      database: 'library_db',
      entities: [Book, User, Loan],
      synchronize: true, // Set to false in production
      logging: true,
    }),
    BooksModule,
    UsersModule,
    LoansModule,
  ],
})
export class AppModule {}

