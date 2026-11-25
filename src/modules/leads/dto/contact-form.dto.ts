import { Transform } from 'class-transformer';
import {
  Allow,
  Equals,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  PUBLIC_LOCALES,
  type PublicLocale,
} from '../../../common/i18n/locale.js';
import { ReportInvalidFields } from '../../../common/validation/app-validation.pipe.js';
import { Trim } from '../../../common/validation/transforms.js';

/** Values of `interest` in the contact form and the label stored in Lead.interest. */
export const FORM_INTERESTS = {
  SAAS: 'Plataforma SaaS',
  ECOMMERCE: 'Ecommerce',
  WEB_CMS: 'Web / CMS',
  AI: 'IA aplicada',
  OTHER: 'Otro',
} as const;
export type FormInterest = keyof typeof FORM_INTERESTS;
const INTEREST_KEYS = Object.keys(FORM_INTERESTS) as FormInterest[];

/** Trims, and turns a blank optional field into "not sent". */
const TrimOptional = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

/**
 * `POST /leads`: contact form of the public site (docs/API.md 11.1). Its 400s
 * carry `details.fields` so the front can mark the fields.
 */
@ReportInvalidFields()
export class ContactFormDto {
  @Trim()
  @IsString()
  @Length(2, 120, { message: 'name debe tener entre 2 y 120 caracteres' })
  name: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email debe ser un email válido' })
  @MaxLength(254)
  email: string;

  @IsOptional()
  @TrimOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[\d\s+()-]+$/, {
    message: 'phone solo admite dígitos, espacios y los caracteres + ( ) -',
  })
  phone?: string;

  @IsOptional()
  @TrimOptional()
  @IsString()
  @MaxLength(120)
  company?: string;

  @IsOptional()
  @IsIn(INTEREST_KEYS, {
    message: `interest debe ser uno de: ${INTEREST_KEYS.join(', ')}`,
  })
  interest?: FormInterest;

  @Trim()
  @IsString()
  @Length(10, 3000, {
    message: 'message debe tener entre 10 y 3000 caracteres',
  })
  message: string;

  @IsIn(PUBLIC_LOCALES, { message: 'locale debe ser "es" o "en"' })
  locale: PublicLocale;

  @Equals(true, {
    message: 'consent debe ser true (aceptación de la política de privacidad)',
  })
  consent: boolean;

  /** Honeypot: hidden from people, so anything in it means a bot. Never rejected. */
  @Allow()
  website?: unknown;
}
