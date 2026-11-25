import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsInt,
  IsObject,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ReportInvalidFields } from '../../../common/validation/app-validation.pipe.js';
import { isValidTimeZone } from '../../calendar/time-zones.js';
import {
  MAX_INTERVALS_PER_DAY,
  MEETING_DURATION_MAX,
  MEETING_DURATION_MIN,
  MEETING_DURATION_STEP,
  SOCIAL_LINK_MAX_LENGTH,
  timeRangesError,
} from '../site-settings.rules.js';

/** Validates the value only when it is not null (undefined still fails: the key is required). */
const NullOr = () =>
  ValidateIf((_object: object, value: unknown) => value !== null);

export class TimeRangeDto {
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'start debe tener el formato HH:mm (00:00-23:59)',
  })
  start: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'end debe tener el formato HH:mm (00:00-23:59)',
  })
  end: string;
}

@ValidatorConstraint({ name: 'timeRanges' })
class TimeRangesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      !Array.isArray(value) || timeRangesError(value as TimeRangeDto[]) === null
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const error = timeRangesError(args.value as TimeRangeDto[]);
    return `${args.property}: ${error ?? 'intervalos inválidos'}`;
  }
}

/** Decorators of one day: up to 3 sorted, non-overlapping intervals. */
function Day(): PropertyDecorator {
  return (target, key) => {
    IsArray({ message: `${String(key)} debe ser una lista` })(target, key);
    ArrayMaxSize(MAX_INTERVALS_PER_DAY, {
      message: `${String(key)} admite como máximo ${MAX_INTERVALS_PER_DAY} intervalos`,
    })(target, key);
    ValidateNested({ each: true })(target, key);
    Type(() => TimeRangeDto)(target, key);
    Validate(TimeRangesConstraint)(target, key);
  };
}

export class BusinessHoursDto {
  @Day() mon: TimeRangeDto[];
  @Day() tue: TimeRangeDto[];
  @Day() wed: TimeRangeDto[];
  @Day() thu: TimeRangeDto[];
  @Day() fri: TimeRangeDto[];
  @Day() sat: TimeRangeDto[];
  @Day() sun: TimeRangeDto[];
}

/** Decorators of one social link: null or an https URL of up to 300 characters. */
function SocialLink(): PropertyDecorator {
  return (target, key) => {
    const name = String(key);
    NullOr()(target, key);
    IsString({ message: `${name} debe ser null o una URL https` })(target, key);
    MaxLength(SOCIAL_LINK_MAX_LENGTH, {
      message: `${name} admite como máximo ${SOCIAL_LINK_MAX_LENGTH} caracteres`,
    })(target, key);
    IsUrl(
      { protocols: ['https'], require_protocol: true },
      { message: `${name} debe ser null o una URL https` },
    )(target, key);
  };
}

export class SocialLinksDto {
  @SocialLink() linkedin: string | null;
  @SocialLink() github: string | null;
  @SocialLink() instagram: string | null;
}

@ValidatorConstraint({ name: 'timeZone' })
class TimeZoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidTimeZone(value);
  }

  defaultMessage(): string {
    return 'timezone debe ser una zona horaria IANA válida (p. ej. America/Lima)';
  }
}

@ValidatorConstraint({ name: 'durationStep' })
class DurationStepConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'number' && value % MEETING_DURATION_STEP === 0;
  }

  defaultMessage(): string {
    return `meetingDurationMinutes debe ser múltiplo de ${MEETING_DURATION_STEP}`;
  }
}

/**
 * `PUT /admin/settings`: the whole row (docs/API.md 11.5). Its 400s carry
 * `details.fields` such as `socialLinks.github` or `businessHours.mon`.
 */
@ReportInvalidFields({ depth: 2 })
export class UpdateSiteSettingsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'contactEmail debe ser un email válido' })
  @MaxLength(254)
  contactEmail: string;

  /** Spaces, "+" and dashes are stripped before checking; "" counts as null. */
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const digits = value.replace(/[\s+-]/g, '');
    return digits === '' ? null : digits;
  })
  @NullOr()
  @IsString({ message: 'whatsapp debe ser null o un número de 8 a 15 dígitos' })
  @Matches(/^\d{8,15}$/, {
    message: 'whatsapp debe ser null o un número de 8 a 15 dígitos',
  })
  whatsapp: string | null;

  @IsObject({ message: 'socialLinks debe ser un objeto' })
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks: SocialLinksDto;

  @IsObject({ message: 'businessHours debe ser un objeto' })
  @ValidateNested()
  @Type(() => BusinessHoursDto)
  businessHours: BusinessHoursDto;

  @IsString()
  @Validate(TimeZoneConstraint)
  timezone: string;

  @IsInt({ message: 'meetingDurationMinutes debe ser un número entero' })
  @Min(MEETING_DURATION_MIN)
  @Max(MEETING_DURATION_MAX)
  @Validate(DurationStepConstraint)
  meetingDurationMinutes: number;
}
