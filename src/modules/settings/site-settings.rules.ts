// Validation rules and read normalization of SiteSettings (docs/API.md 11.5).
import {
  type BusinessHours,
  parseBusinessHours,
  type TimeRange,
  toMinutes,
  WEEKDAY_KEYS,
} from '../calendar/business-hours.js';

export const MAX_INTERVALS_PER_DAY = 3;
export const MEETING_DURATION_MIN = 15;
export const MEETING_DURATION_MAX = 120;
export const MEETING_DURATION_STEP = 15;
export const SOCIAL_LINK_MAX_LENGTH = 300;
export const SOCIAL_NETWORKS = ['linkedin', 'github', 'instagram'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export type SocialLinks = Record<SocialNetwork, string | null>;

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Days in API order (Monday first). */
export const DAYS_IN_ORDER = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const satisfies readonly (typeof WEEKDAY_KEYS)[number][];

/**
 * Why the intervals of one day are invalid (in Spanish), or null when they
 * are fine: each start before its end, sorted, without overlaps. The format
 * of each time is checked separately; malformed ones are skipped here.
 */
export function timeRangesError(ranges: TimeRange[]): string | null {
  let previousEnd = -1;
  for (const range of ranges) {
    if (
      typeof range?.start !== 'string' ||
      typeof range?.end !== 'string' ||
      !HH_MM.test(range.start) ||
      !HH_MM.test(range.end)
    ) {
      return null;
    }
    const start = toMinutes(range.start);
    const end = toMinutes(range.end);
    if (start >= end) {
      return `el inicio (${range.start}) debe ser anterior al fin (${range.end})`;
    }
    if (start < previousEnd) {
      return 'los intervalos deben estar ordenados y no superponerse';
    }
    previousEnd = end;
  }
  return null;
}

/** Stored socialLinks JSON -> always the three keys (null when missing or not a string). */
export function parseSocialLinks(value: unknown): SocialLinks {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const links = {} as SocialLinks;
  for (const network of SOCIAL_NETWORKS) {
    const link = record[network];
    links[network] = typeof link === 'string' && link !== '' ? link : null;
  }
  return links;
}

/** Stored businessHours JSON -> the seven days, Monday first. */
export function normalizeBusinessHours(value: unknown): BusinessHours {
  const parsed = parseBusinessHours(value);
  const result = {} as BusinessHours;
  for (const day of DAYS_IN_ORDER) {
    result[day] = parsed[day].map(({ start, end }) => ({ start, end }));
  }
  return result;
}

/** Canonical spelling of a valid IANA zone ("america/lima" -> "America/Lima"). */
export function canonicalTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions()
    .timeZone;
}
