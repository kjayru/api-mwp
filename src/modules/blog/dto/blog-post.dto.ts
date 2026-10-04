import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
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
import {
  BLOG_CONTENT_MAX,
  BLOG_EXCERPT_MAX,
  BLOG_MAX_TECHNOLOGIES,
  BLOG_SEO_DESCRIPTION_MAX,
  BLOG_SEO_TITLE_MAX,
  BLOG_TITLE_MAX,
} from '../blog-limits.js';

export class CreateBlogPostTranslationDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'title no debe estar vacío' })
  @MaxLength(BLOG_TITLE_MAX)
  title: string;

  /** Generated from the title when omitted. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE })
  slug?: string;
}

export class CreateBlogPostTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateBlogPostTranslationDto)
  ES?: CreateBlogPostTranslationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateBlogPostTranslationDto)
  EN?: CreateBlogPostTranslationDto;
}

/** `POST /admin/blog`: minimal body; the post starts as a DRAFT. */
export class CreateBlogPostDto {
  /** At least one locale (checked by the service). */
  @IsObject()
  @ValidateNested()
  @Type(() => CreateBlogPostTranslationsDto)
  translations: CreateBlogPostTranslationsDto;
}

/**
 * Partial translation. When the locale does not exist yet it is created
 * (DRAFT) and `title` is required. Nullable fields accept `null` (or "") to
 * clear them.
 */
export class UpdateBlogPostTranslationDto {
  @IsOptionalNonNull()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'title no debe estar vacío' })
  @MaxLength(BLOG_TITLE_MAX)
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
  @MaxLength(BLOG_EXCERPT_MAX)
  excerpt?: string | null;

  /** Markdown, stored as sent (not trimmed: leading indentation is meaningful). */
  @IsOptionalNonNull()
  @IsString()
  @MaxLength(BLOG_CONTENT_MAX, {
    message: `content admite como máximo ${BLOG_CONTENT_MAX} caracteres`,
  })
  content?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(BLOG_SEO_TITLE_MAX)
  seoTitle?: string | null;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(BLOG_SEO_DESCRIPTION_MAX)
  seoDescription?: string | null;
}

export class UpdateBlogPostTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBlogPostTranslationDto)
  ES?: UpdateBlogPostTranslationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBlogPostTranslationDto)
  EN?: UpdateBlogPostTranslationDto;
}

/** `PATCH /admin/blog/:id`: any subset of the editable fields. */
export class UpdateBlogPostDto {
  @IsOptional()
  @IsUrl(HTTP_URL_OPTIONS, {
    message: 'coverImageUrl debe ser una URL http(s)',
  })
  @MaxLength(URL_MAX_LENGTH)
  coverImageUrl?: string | null;

  /** Replaces the linked technologies, in this (chip) order. */
  @IsOptionalNonNull()
  @IsArray()
  @ArrayMaxSize(BLOG_MAX_TECHNOLOGIES)
  @ArrayUnique({ message: 'technologyIds no debe tener ids repetidos' })
  @IsString({ each: true })
  technologyIds?: string[];

  @IsOptionalNonNull()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateBlogPostTranslationsDto)
  translations?: UpdateBlogPostTranslationsDto;
}
