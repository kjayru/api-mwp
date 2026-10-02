import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';
import { Locale } from '../../generated/prisma/enums.js';

/** Content locales, in display order (ES first). */
export const LOCALES: readonly Locale[] = [Locale.ES, Locale.EN];

/** Locales of the public endpoints (`?locale=es|en`), lowercase like the site URLs. */
export const PUBLIC_LOCALES = ['es', 'en'] as const;
export type PublicLocale = (typeof PUBLIC_LOCALES)[number];

export function toDbLocale(locale: PublicLocale): Locale {
  return locale === 'es' ? Locale.ES : Locale.EN;
}

/** `?locale=es|en`, required on every public content endpoint. */
export class PublicLocaleQueryDto {
  @IsIn(PUBLIC_LOCALES, { message: 'locale debe ser "es" o "en"' })
  locale: PublicLocale;
}

/** `{ "locale": "ES" | "EN" }` body of the admin publish/unpublish endpoints. */
export class LocaleBodyDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(LOCALES, { message: 'locale debe ser "ES" o "EN"' })
  locale: Locale;
}

/** Object with one entry per locale, e.g. `{ ES: ..., EN: ... }`. */
export type PerLocale<T> = Record<Locale, T>;
