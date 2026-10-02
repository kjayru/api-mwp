import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';

// Admin CRUD of users (controller) arrives in Phase 5.
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
