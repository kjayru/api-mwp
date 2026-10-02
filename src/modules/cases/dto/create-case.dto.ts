import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  SLUG_MAX_LENGTH,
  SLUG_MESSAGE,
  SLUG_PATTERN,
} from '../../../common/slug.js';
import { Trim } from '../../../common/validation/transforms.js';
import { CaseType } from '../../../generated/prisma/enums.js';

export const CASE_TITLE_MAX = 200;

export class CreateCaseTranslationDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'title no debe estar vacío' })
  @MaxLength(CASE_TITLE_MAX)
  title: string;

  /** Generated from the title when omitted. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug?: string;
}

export class CreateCaseTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCaseTranslationDto)
  ES?: CreateCaseTranslationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCaseTranslationDto)
  EN?: CreateCaseTranslationDto;
}

/** `POST /admin/cases`: minimal body; everything else gets defaults and DRAFT. */
export class CreateCaseDto {
  @IsEnum(CaseType, {
    message: 'type debe ser SAAS, ECOMMERCE, WEB_CMS, TOOL o PLATFORM',
  })
  type: CaseType;

  /** At least one locale (checked by the service). */
  @IsObject()
  @ValidateNested()
  @Type(() => CreateCaseTranslationsDto)
  translations: CreateCaseTranslationsDto;
}
