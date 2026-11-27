import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
  PUBLIC_LOCALES,
  type PublicLocale,
} from '../../../common/i18n/locale.js';

export const PREVIEW_TYPES = ['case', 'post'] as const;
export type PreviewType = (typeof PREVIEW_TYPES)[number];

/** `POST /admin/preview` */
export class CreatePreviewDto {
  @IsIn(PREVIEW_TYPES, { message: 'type debe ser "case" o "post"' })
  type: PreviewType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id: string;

  @IsIn(PUBLIC_LOCALES, { message: 'locale debe ser "es" o "en"' })
  locale: PublicLocale;
}

/** `POST /preview/resolve` */
export class ResolvePreviewDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  token: string;
}
