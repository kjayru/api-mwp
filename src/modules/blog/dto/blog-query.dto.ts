import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PublicLocaleQueryDto } from '../../../common/i18n/locale.js';
import { PaginationQueryDto } from '../../../common/pagination/pagination.js';
import { ToLowerCase, Trim } from '../../../common/validation/transforms.js';

export const PUBLIC_BLOG_DEFAULT_LIMIT = 12;
export const PUBLIC_BLOG_MAX_LIMIT = 50;

/** `GET /blog?locale=es&page=1&limit=12` (limit max 50). */
export class PublicBlogQueryDto extends PublicLocaleQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PUBLIC_BLOG_MAX_LIMIT)
  limit: number = PUBLIC_BLOG_DEFAULT_LIMIT;
}

export const ADMIN_BLOG_SORTS = ['updatedAt', 'publishedAt', 'title'] as const;
export type AdminBlogSort = (typeof ADMIN_BLOG_SORTS)[number];

/** `GET /admin/blog?page&limit&q&status&sort&order` */
export class AdminBlogQueryDto extends PaginationQueryDto {
  /** Searches the title of both locales (case-insensitive). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Matches when any locale has this status. */
  @IsOptional()
  @ToLowerCase()
  @IsIn(['draft', 'published'], {
    message: 'status debe ser "draft" o "published"',
  })
  status?: 'draft' | 'published';

  @IsOptional()
  @IsIn(ADMIN_BLOG_SORTS, {
    message: 'sort debe ser updatedAt, publishedAt o title',
  })
  sort: AdminBlogSort = 'updatedAt';

  /** Default: asc for title, desc otherwise. */
  @IsOptional()
  @ToLowerCase()
  @IsIn(['asc', 'desc'], { message: 'order debe ser "asc" o "desc"' })
  order?: 'asc' | 'desc';
}
