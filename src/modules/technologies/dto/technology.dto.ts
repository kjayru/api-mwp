import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
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
import { PublicLocaleQueryDto } from '../../../common/i18n/locale.js';
import {
  SLUG_MAX_LENGTH,
  SLUG_MESSAGE,
  SLUG_PATTERN,
} from '../../../common/slug.js';
import { IsOptionalNonNull } from '../../../common/validation/is-optional-non-null.js';
import { ToBoolean, Trim } from '../../../common/validation/transforms.js';
import { TechnologyCategory } from '../../../generated/prisma/enums.js';

const CATEGORY_MESSAGE =
  'category debe ser FRONTEND, BACKEND, DATABASE, MOBILE, CLOUD, AI u OTHER';

/** `GET /technologies?locale=es&featured=true` */
export class PublicTechnologiesQueryDto extends PublicLocaleQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean({ message: 'featured debe ser "true" o "false"' })
  featured?: boolean;
}

/** `{ ES?, EN? }`: omitted keys are kept, `null` or "" clears a locale. */
export class TechnologyDescriptionsDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  ES?: string | null;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  EN?: string | null;
}

/** `POST /admin/technologies` */
export class CreateTechnologyDto {
  /** Proper noun, not translated (".NET Core"). Unique, case-insensitive. */
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'name no debe estar vacío' })
  @MaxLength(80)
  name: string;

  /** Generated from the name when omitted. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug?: string;

  @IsOptional()
  @IsEnum(TechnologyCategory, { message: CATEGORY_MESSAGE })
  category?: TechnologyCategory;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TechnologyDescriptionsDto)
  descriptions?: TechnologyDescriptionsDto;
}

/** `PATCH /admin/technologies/:id` */
export class UpdateTechnologyDto {
  @IsOptionalNonNull()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'name no debe estar vacío' })
  @MaxLength(80)
  name?: string;

  @IsOptionalNonNull()
  @Trim()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug?: string;

  @IsOptionalNonNull()
  @IsEnum(TechnologyCategory, { message: CATEGORY_MESSAGE })
  category?: TechnologyCategory;

  @IsOptionalNonNull()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptionalNonNull()
  @IsObject()
  @ValidateNested()
  @Type(() => TechnologyDescriptionsDto)
  descriptions?: TechnologyDescriptionsDto;
}
