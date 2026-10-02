import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsOptionalNonNull } from '../../../common/validation/is-optional-non-null.js';
import {
  HTTP_URL_OPTIONS,
  Trim,
  URL_MAX_LENGTH,
} from '../../../common/validation/transforms.js';

export const ALT_MAX_LENGTH = 300;

/** `{ ES?, EN? }`: omitted keys are kept, `null` clears a locale. */
export class ImageAltDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(ALT_MAX_LENGTH)
  ES?: string | null;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(ALT_MAX_LENGTH)
  EN?: string | null;
}

/** `POST /admin/cases/:id/images` (usually with the url returned by /admin/uploads). */
export class CreateCaseImageDto {
  @IsUrl(HTTP_URL_OPTIONS, { message: 'url debe ser una URL http(s)' })
  @MaxLength(URL_MAX_LENGTH)
  url: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ImageAltDto)
  alt?: ImageAltDto;
}

/** `PATCH /admin/cases/:id/images/:imageId` */
export class UpdateCaseImageDto {
  @IsOptionalNonNull()
  @IsObject()
  @ValidateNested()
  @Type(() => ImageAltDto)
  alt?: ImageAltDto;

  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
