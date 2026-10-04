import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { LocaleBodyDto } from '../../common/i18n/locale.js';
import type { Paginated } from '../../common/pagination/pagination.js';
import { AdminBlogService } from './admin-blog.service.js';
import { CreateBlogPostDto, UpdateBlogPostDto } from './dto/blog-post.dto.js';
import { AdminBlogQueryDto } from './dto/blog-query.dto.js';
import type {
  AdminBlogPost,
  AdminBlogPostListItem,
} from './entities/blog.entity.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/blog')
export class AdminBlogController {
  constructor(private readonly blog: AdminBlogService) {}

  @Get()
  list(
    @Query() query: AdminBlogQueryDto,
  ): Promise<Paginated<AdminBlogPostListItem>> {
    return this.blog.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<AdminBlogPost> {
    return this.blog.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateBlogPostDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminBlogPost> {
    return this.blog.create(dto, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBlogPostDto,
  ): Promise<AdminBlogPost> {
    return this.blog.update(id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id') id: string,
    @Body() dto: LocaleBodyDto,
  ): Promise<AdminBlogPost> {
    return this.blog.publish(id, dto.locale);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @Param('id') id: string,
    @Body() dto: LocaleBodyDto,
  ): Promise<AdminBlogPost> {
    return this.blog.unpublish(id, dto.locale);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.blog.remove(id);
  }
}
