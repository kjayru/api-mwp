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
import { PaginationQueryDto } from '../../../common/pagination/pagination.js';
import { ToLowerCase, Trim } from '../../../common/validation/transforms.js';

export const CONVERSATION_FILTERS = ['all', 'lead', 'unanswered'] as const;
export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number];

/** `GET /admin/conversations?page&limit&filter&q` */
export class AdminConversationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @ToLowerCase()
  @IsIn(CONVERSATION_FILTERS, {
    message: 'filter debe ser "all", "lead" o "unanswered"',
  })
  filter: ConversationFilter = 'all';

  /** Searches every message and the lead's name and email (case-insensitive). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  q?: string;
}

/** `?days=N` of the dashboard endpoints. */
export class DaysQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
