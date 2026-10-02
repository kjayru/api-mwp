import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  SLUG_MAX_LENGTH,
  SLUG_MESSAGE,
  SLUG_PATTERN,
} from '../../../common/slug.js';
import { IsOptionalNonNull } from '../../../common/validation/is-optional-non-null.js';
import {
  HTTP_URL_OPTIONS,
  Trim,
  URL_MAX_LENGTH,
} from '../../../common/validation/transforms.js';
import { CaseType } from '../../../generated/prisma/enums.js';
import { BLOCK_LIMITS } from '../case-blocks.js';
import { CASE_TITLE_MAX } from './create-case.dto.js';

export const MAX_LINKED_TECHNOLOGIES = 50;

/**
 * Partial translation. When the locale does not exist yet it is created
 * (DRAFT) and `title` is required. Nullable fields accept `null` to clear them.
 */
export class UpdateCaseTranslationDto {
  @IsOptionalNonNull()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'title no debe estar vacío' })
  @MaxLength(CASE_TITLE_MAX)
  title?: string;

  @IsOptionalNonNull()
  @Trim()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  tagline?: string | null;

  @IsOptionalNonNull()
  @Trim()
  @IsString()
  @MaxLength(1000)
  summary?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  industry?: string | null;

  /** CaseBlock[]; validated in depth by validateCaseBlocks (case-blocks.ts). */
  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(BLOCK_LIMITS.blocks, {
    message: `blocks admite como máximo ${BLOCK_LIMITS.blocks} bloques`,
  })
  blocks?: unknown[];

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  seoTitle?: string | null;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(160)
  seoDescription?: string | null;
}

export class UpdateCaseTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateCaseTranslationDto)
  ES?: UpdateCaseTranslationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateCaseTranslationDto)
  EN?: UpdateCaseTranslationDto;
}

/** `PATCH /admin/cases/:id`: any subset of the editable fields. */
export class UpdateCaseDto {
  @IsOptionalNonNull()
  @IsEnum(CaseType, {
    message: 'type debe ser SAAS, ECOMMERCE, WEB_CMS, TOOL o PLATFORM',
  })
  type?: CaseType;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  client?: string | null;

  @IsOptionalNonNull()
  @IsBoolean()
  anonymizeClient?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1990)
  @Max(2100)
  year?: number | null;

  @IsOptional()
  @IsUrl(HTTP_URL_OPTIONS, {
    message: 'coverImageUrl debe ser una URL http(s)',
  })
  @MaxLength(URL_MAX_LENGTH)
  coverImageUrl?: string | null;

  @IsOptionalNonNull()
  @IsBoolean()
  includeInKnowledgeBase?: boolean;

  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /** Replaces the linked technologies, in this (chip) order. */
  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(MAX_LINKED_TECHNOLOGIES)
  @ArrayUnique({ message: 'technologyIds no debe tener ids repetidos' })
  @IsString({ each: true })
  technologyIds?: string[];

  @IsOptionalNonNull()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateCaseTranslationsDto)
  translations?: UpdateCaseTranslationsDto;
}
