import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.js';
import { IsOptionalNonNull } from '../../../common/validation/is-optional-non-null.js';
import { ToLowerCase, Trim } from '../../../common/validation/transforms.js';

export const FAQ_QUESTION_MAX = 300;
/** Markdown answer. */
export const FAQ_ANSWER_MAX = 10_000;

export class CreateFaqTranslationDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'question no debe estar vacía' })
  @MaxLength(FAQ_QUESTION_MAX)
  question: string;

  @IsOptional()
  @IsString()
  @MaxLength(FAQ_ANSWER_MAX)
  answer?: string;
}

export class CreateFaqTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateFaqTranslationDto)
  ES?: CreateFaqTranslationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateFaqTranslationDto)
  EN?: CreateFaqTranslationDto;
}

/** `POST /admin/faqs`: every locale starts as a DRAFT. */
export class CreateFaqDto {
  /** At least one locale (checked by the service). */
  @IsObject()
  @ValidateNested()
  @Type(() => CreateFaqTranslationsDto)
  translations: CreateFaqTranslationsDto;
}

export class UpdateFaqTranslationDto {
  @IsOptionalNonNull()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'question no debe estar vacía' })
  @MaxLength(FAQ_QUESTION_MAX)
  question?: string;

  /** Markdown, stored as sent (not trimmed). */
  @IsOptionalNonNull()
  @IsString()
  @MaxLength(FAQ_ANSWER_MAX)
  answer?: string;
}

export class UpdateFaqTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateFaqTranslationDto)
  ES?: UpdateFaqTranslationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateFaqTranslationDto)
  EN?: UpdateFaqTranslationDto;
}

/** `PATCH /admin/faqs/:id` */
export class UpdateFaqDto {
  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptionalNonNull()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateFaqTranslationsDto)
  translations?: UpdateFaqTranslationsDto;
}

/** `GET /admin/faqs?page&limit&q&status` */
export class AdminFaqsQueryDto extends PaginationQueryDto {
  /** Searches the question and answer of both locales (case-insensitive). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @ToLowerCase()
  @IsIn(['draft', 'published'], {
    message: 'status debe ser "draft" o "published"',
  })
  status?: 'draft' | 'published';
}
