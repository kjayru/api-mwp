import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { PublicLocaleQueryDto } from '../../common/i18n/locale.js';
import { PublicCache } from '../../common/interceptors/public-cache.interceptor.js';
import type { Paginated } from '../../common/pagination/pagination.js';
import { BlogService } from './blog.service.js';
import { PublicBlogQueryDto } from './dto/blog-query.dto.js';
import type {
  PublicBlogPostDetail,
  PublicBlogPostListItem,
} from './entities/blog.entity.js';

/** Public site: published posts only. */
@Public()
@PublicCache()
@Controller('blog')
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  @Get()
  list(
    @Query() query: PublicBlogQueryDto,
  ): Promise<Paginated<PublicBlogPostListItem>> {
    return this.blog.list(query.locale, query.page, query.limit);
  }

  @Get(':slug')
  findOne(
    @Param('slug') slug: string,
    @Query() query: PublicLocaleQueryDto,
  ): Promise<PublicBlogPostDetail> {
    return this.blog.findBySlug(query.locale, slug);
  }
}
