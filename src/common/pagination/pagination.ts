import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** `?page=1&limit=20` (limit max 100). */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

/** Shape of every paginated listing. */
export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

/** Shape of every non-paginated listing. */
export interface ListResponse<T> {
  data: T[];
}
