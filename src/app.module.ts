import { env } from './config/env';
import { Module, ClassSerializerInterceptor } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BooksModule } from './books/books.module';
import { UsersModule } from './users/users.module';
import { LoansModule } from './loans/loans.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { GroupsModule } from './groups/groups.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { Book } from './books/entities/book.entity';
import { User } from './users/entities/user.entity';
import { Loan } from './loans/entities/loan.entity';
import { Role } from './roles/entities/role.entity';
import { Group } from './groups/entities/group.entity';
import { RefreshToken } from './auth/entities/refresh-token.entity';
import { Notification } from './notifications/entities/notification.entity';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { join } from 'path';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: env.database.host,
      port: env.database.port,
      username: env.database.username,
      password: env.database.password,
      database: env.database.name,
      entities: [Book, User, Loan, Role, Group, RefreshToken, Notification],
      // Glob covers both the compiled output and ts-node runs (npm run seed).
      migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
      migrationsRun: env.database.migrationsRun,
      synchronize: env.database.synchronize,
      logging: env.database.logging,
    }),
    AuthModule,
    GroupsModule,
    RolesModule,
    BooksModule,
    UsersModule,
    LoansModule,
    DashboardModule,
    NotificationsModule,
  ],
  providers: [
    {
      // Registered first so a flood of unauthenticated requests is rejected
      // before any password hashing or database work happens.
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      // Applies the @Exclude() rules on entities to every response, so secrets
      // like password hashes can never be serialised out by accident.
      provide: APP_INTERCEPTOR,
      useClass: ClassSerializerInterceptor,
    },
  ],
})
export class AppModule {}
