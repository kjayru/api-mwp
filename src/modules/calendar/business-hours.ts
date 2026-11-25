// Business hours (SiteSettings.businessHours) and meeting slot arithmetic.
import { zonedParts, zonedTimeToUtc } from './time-zones.js';

/** Indexed by Date#getDay(): 0 = Sunday. */
export const WEEKDAY_KEYS = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export interface TimeRange {
  /** "HH:mm" */
  start: string;
  end: string;
}

export type BusinessHours = Record<WeekdayKey, TimeRange[]>;

export interface Interval {
  start: Date;
  end: Date;
}

const WEEKDAY_HOURS: TimeRange[] = [{ start: '08:00', end: '19:00' }];

/** Monday to Saturday, 08:00-19:00 (decision 7). Used when the setting is invalid. */
export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: WEEKDAY_HOURS,
  tue: WEEKDAY_HOURS,
  wed: WEEKDAY_HOURS,
  thu: WEEKDAY_HOURS,
  fri: WEEKDAY_HOURS,
  sat: WEEKDAY_HOURS,
  sun: [],
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Validates the stored JSON. Invalid ranges are dropped; a value that is not
 * an object at all falls back to DEFAULT_BUSINESS_HOURS.
 */
export function parseBusinessHours(value: unknown): BusinessHours {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_BUSINESS_HOURS;
  }
  const record = value as Record<string, unknown>;
  const result = {} as BusinessHours;
  for (const key of WEEKDAY_KEYS) {
    const ranges = Array.isArray(record[key]) ? (record[key] as unknown[]) : [];
    result[key] = ranges.filter((range): range is TimeRange => {
      if (typeof range !== 'object' || range === null) return false;
      const { start, end } = range as Record<string, unknown>;
      return (
        typeof start === 'string' &&
        typeof end === 'string' &&
        TIME.test(start) &&
        TIME.test(end) &&
        toMinutes(start) < toMinutes(end)
      );
    });
  }
  return result;
}

/**
 * True when [start, start + duration) lies inside one business-hours range
 * of a single local day in `timeZone` (so it ends by closing time and never
 * falls on a closed day such as Sunday).
 */
export function fitsBusinessHours(
  start: Date,
  durationMinutes: number,
  hours: BusinessHours,
  timeZone: string,
): boolean {
  const local = zonedParts(start, timeZone);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const localEnd = zonedParts(end, timeZone);
  const startMinutes = local.hour * 60 + local.minute;
  let endMinutes = localEnd.hour * 60 + localEnd.minute;
  const sameDay =
    local.year === localEnd.year &&
    local.month === localEnd.month &&
    local.day === localEnd.day;
  if (!sameDay) {
    // Only an end at exactly midnight is acceptable (a range ending at 24:00).
    if (endMinutes !== 0) return false;
    endMinutes = 24 * 60;
  }
  const ranges = hours[WEEKDAY_KEYS[local.weekday]] ?? [];
  return ranges.some(
    (range) =>
      startMinutes >= toMinutes(range.start) &&
      endMinutes <= toMinutes(range.end),
  );
}

/**
 * Meeting starts inside business hours, every `stepMinutes` from the start
 * of each range, from `from` (inclusive) over the next `days` local days.
 */
export function candidateStarts(
  from: Date,
  days: number,
  durationMinutes: number,
  hours: BusinessHours,
  timeZone: string,
  stepMinutes = 30,
): Date[] {
  const today = zonedParts(from, timeZone);
  const starts: Date[] = [];
  for (let offset = 0; offset <= days; offset++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const ranges = hours[WEEKDAY_KEYS[day.getUTCDay()]] ?? [];
    for (const range of ranges) {
      const close = toMinutes(range.end);
      for (
        let minute = toMinutes(range.start);
        minute + durationMinutes <= close;
        minute += stepMinutes
      ) {
        const start = zonedTimeToUtc(
          {
            year: day.getUTCFullYear(),
            month: day.getUTCMonth() + 1,
            day: day.getUTCDate(),
            hour: Math.floor(minute / 60),
            minute: minute % 60,
          },
          timeZone,
        );
        if (start && start.getTime() >= from.getTime()) starts.push(start);
      }
    }
  }
  return starts.sort((a, b) => a.getTime() - b.getTime());
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

export function isFree(slot: Interval, busy: Interval[]): boolean {
  return !busy.some((interval) => overlaps(slot, interval));
}

/** The first `count` candidate starts whose meeting does not overlap `busy`. */
export function firstFreeSlots(
  candidates: Date[],
  durationMinutes: number,
  busy: Interval[],
  count: number,
): Date[] {
  const free: Date[] = [];
  for (const start of candidates) {
    const slot = {
      start,
      end: new Date(start.getTime() + durationMinutes * 60_000),
    };
    if (isFree(slot, busy)) free.push(start);
    if (free.length >= count) break;
  }
  return free;
}
