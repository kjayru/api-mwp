import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.js';
import { ToLowerCase, Trim } from '../../../common/validation/transforms.js';
import { CaseType } from '../../../generated/prisma/enums.js';

export const ADMIN_CASE_SORTS = ['sortOrder', 'updatedAt', 'title'] as const;
export type AdminCaseSort = (typeof ADMIN_CASE_SORTS)[number];

/** `GET /admin/cases?page&limit&q&type&status&sort&order` */
export class AdminCasesQueryDto extends PaginationQueryDto {
  /** Searches the title of both locales (case-insensitive). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsEnum(CaseType, {
    message: 'type debe ser SAAS, ECOMMERCE, WEB_CMS, TOOL o PLATFORM',
  })
  type?: CaseType;

  /** Matches when any locale has this status. */
  @IsOptional()
  @ToLowerCase()
  @IsIn(['draft', 'published'], {
    message: 'status debe ser "draft" o "published"',
  })
  status?: 'draft' | 'published';

  @IsOptional()
  @IsIn(ADMIN_CASE_SORTS, {
    message: 'sort debe ser sortOrder, updatedAt o title',
  })
  sort: AdminCaseSort = 'sortOrder';

  /** Default: desc for updatedAt, asc otherwise. */
  @IsOptional()
  @ToLowerCase()
  @IsIn(['asc', 'desc'], { message: 'order debe ser "asc" o "desc"' })
  order?: 'asc' | 'desc';
}
