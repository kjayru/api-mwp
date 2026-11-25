import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/password.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { UsersService } from './users.service.js';

/** Users: lookups for auth and the admin CRUD (ADMIN only, docs/API.md 11.6). */
@Module({
  controllers: [AdminUsersController],
  providers: [UsersService, PasswordService, AdminUsersService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
