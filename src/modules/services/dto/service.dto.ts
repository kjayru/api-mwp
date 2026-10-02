import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
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
import { Trim } from '../../../common/validation/transforms.js';

export const SERVICE_TITLE_MAX = 200;
export const SERVICE_DESCRIPTION_MAX = 2000;
const MAX_LINKED_TECHNOLOGIES = 50;

/**
 * Translation of a service. On create `title` is required; on update every field
 * is optional, but creating a missing locale through PATCH requires `title`.
 */
export class ServiceTranslationDto {
  @IsOptionalNonNull()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'title no debe estar vacío' })
  @MaxLength(SERVICE_TITLE_MAX)
  title?: string;

  /** Anchor on /servicios. Generated from the title when omitted on creation. */
  @IsOptionalNonNull()
  @Trim()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug?: string;

  @IsOptionalNonNull()
  @Trim()
  @IsString()
  @MaxLength(SERVICE_DESCRIPTION_MAX)
  description?: string;
}

// Standalone (not `extends ServiceTranslationDto`): an inherited ValidateIf would
// skip the required check on `title`.
export class CreateServiceTranslationDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'title no debe estar vacío' })
  @MaxLength(SERVICE_TITLE_MAX)
  title: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(SERVICE_DESCRIPTION_MAX)
  description?: string;
}

export class CreateServiceTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateServiceTranslationDto)
  ES?: CreateServiceTranslationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateServiceTranslationDto)
  EN?: CreateServiceTranslationDto;
}

export class UpdateServiceTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceTranslationDto)
  ES?: ServiceTranslationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceTranslationDto)
  EN?: ServiceTranslationDto;
}

/** `POST /admin/services`: created as DRAFT in every given locale. */
export class CreateServiceDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LINKED_TECHNOLOGIES)
  @ArrayUnique({ message: 'technologyIds no debe tener ids repetidos' })
  @IsString({ each: true })
  technologyIds?: string[];

  /** At least one locale (checked by the service). */
  @IsObject()
  @ValidateNested()
  @Type(() => CreateServiceTranslationsDto)
  translations: CreateServiceTranslationsDto;
}

/** `PATCH /admin/services/:id` */
export class UpdateServiceDto {
  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /** Replaces the linked technologies, in this order. */
  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(MAX_LINKED_TECHNOLOGIES)
  @ArrayUnique({ message: 'technologyIds no debe tener ids repetidos' })
  @IsString({ each: true })
  technologyIds?: string[];

  @IsOptionalNonNull()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateServiceTranslationsDto)
  translations?: UpdateServiceTranslationsDto;
}
