import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsOptionalNonNull } from '../../../common/validation/is-optional-non-null.js';
import { PaginationQueryDto } from '../../../common/pagination/pagination.js';
import { ToLowerCase, Trim } from '../../../common/validation/transforms.js';
import { LeadSource, LeadStatus } from '../../../generated/prisma/enums.js';

export const LEAD_STATUSES = Object.values(LeadStatus);
export const LEAD_SOURCES = Object.values(LeadSource);
export const LEAD_SORTS = ['createdAt', 'updatedAt', 'name'] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];
export const NOTES_MAX_LENGTH = 5000;

const ToUpperCase = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  );

/** `GET /admin/leads?page&limit&status&source&q&sort&order` */
export class AdminLeadsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @ToUpperCase()
  @IsIn(LEAD_STATUSES, {
    message: `status debe ser uno de: ${LEAD_STATUSES.join(', ')}`,
  })
  status?: LeadStatus;

  @IsOptional()
  @ToUpperCase()
  @IsIn(LEAD_SOURCES, {
    message: `source debe ser uno de: ${LEAD_SOURCES.join(', ')}`,
  })
  source?: LeadSource;

  /** Name, email, phone, interest and message (case-insensitive). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(LEAD_SORTS, {
    message: `sort debe ser uno de: ${LEAD_SORTS.join(', ')}`,
  })
  sort: LeadSort = 'createdAt';

  @IsOptional()
  @ToLowerCase()
  @IsIn(['asc', 'desc'], { message: 'order debe ser "asc" o "desc"' })
  order: 'asc' | 'desc' = 'desc';
}

/** `PATCH /admin/leads/:id` */
export class UpdateLeadDto {
  @IsOptionalNonNull()
  @IsIn(LEAD_STATUSES, {
    message: `status debe ser uno de: ${LEAD_STATUSES.join(', ')}`,
  })
  status?: LeadStatus;

  /** "" or null clears the notes; omitted keeps them. */
  @ValidateIf(
    (_object: object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString()
  @MaxLength(NOTES_MAX_LENGTH, {
    message: `notes admite como máximo ${NOTES_MAX_LENGTH} caracteres`,
  })
  notes?: string | null;
}
