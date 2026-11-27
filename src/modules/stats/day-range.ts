import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  isValidTimeZone,
  zonedParts,
  zonedTimeToUtc,
} from '../calendar/time-zones.js';

export const DEFAULT_TIME_ZONE = 'America/Lima';

export interface DayRange {
  timeZone: string;
  /** Local dates (YYYY-MM-DD), oldest first; the last one is today. */
  dates: string[];
  /** UTC instant at which the first local day starts. */
  fromUtc: Date;
}

/** SiteSettings.timezone, or America/Lima when unset or invalid. */
export async function siteTimeZone(
  prisma: Pick<PrismaService, 'siteSettings'>,
): Promise<string> {
  const settings = await prisma.siteSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true },
  });
  return settings?.timezone && isValidTimeZone(settings.timezone)
    ? settings.timezone
    : DEFAULT_TIME_ZONE;
}

/** The last `days` calendar days (today included) in `timeZone`. */
export function dayRange(days: number, now: Date, timeZone: string): DayRange {
  const today = zonedParts(now, timeZone);
  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(
      Date.UTC(today.year, today.month - 1, today.day - offset),
    );
    dates.push(day.toISOString().slice(0, 10));
  }
  const [fromYear, fromMonth, fromDay] = dates[0].split('-').map(Number);
  const fromUtc =
    zonedTimeToUtc(
      { year: fromYear, month: fromMonth, day: fromDay, hour: 0, minute: 0 },
      timeZone,
    ) ?? new Date(Date.UTC(fromYear, fromMonth - 1, fromDay));
  return { timeZone, dates, fromUtc };
}
