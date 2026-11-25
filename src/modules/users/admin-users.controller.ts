import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { ListResponse } from '../../common/pagination/pagination.js';
import { AdminUsersService } from './admin-users.service.js';
import {
  CreateUserDto,
  SetPasswordDto,
  UpdateUserDto,
} from './dto/user.dto.js';
import type { AdminUser } from './entities/user.entity.js';

@Roles('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(): Promise<ListResponse<AdminUser>> {
    return this.users.list();
  }

  @Post()
  create(@Body() dto: CreateUserDto): Promise<AdminUser> {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<AdminUser> {
    return this.users.update(caller.id, id, dto);
  }

  /** Sets a new password and revokes every session of that user. */
  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPassword(
    @Param('id') id: string,
    @Body() dto: SetPasswordDto,
  ): Promise<void> {
    await this.users.setPassword(id, dto.password);
  }
}
