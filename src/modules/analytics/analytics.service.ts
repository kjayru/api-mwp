import { Injectable, Logger } from '@nestjs/common';
import { isUniqueViolation } from '../../common/prisma-errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { zonedParts } from '../calendar/time-zones.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  isBotUserAgent,
  normalizeTrackedPath,
  trackedLocale,
} from './page-views.js';

export interface TrackInput {
  /** Raw JSON body; validated here so that /track never answers an error. */
  body: unknown;
  userAgent?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar day of `now` in `timeZone`, as the UTC midnight Prisma stores in a DATE column. */
export function localDay(now: Date, timeZone: string): Date {
  const { year, month, day } = zonedParts(now, timeZone);
  return new Date(`${year}-${pad(month)}-${pad(day)}T00:00:00.000Z`);
}

/** Page views aggregated per day, path and locale. No IP, cookie or id is stored. */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Counts the view, or ignores it. Never throws. Returns whether it was counted. */
  async track(input: TrackInput, now: Date = new Date()): Promise<boolean> {
    try {
      if (isBotUserAgent(input.userAgent)) return false;
      const body =
        typeof input.body === 'object' && input.body !== null
          ? (input.body as Record<string, unknown>)
          : {};
      const path = normalizeTrackedPath(body.path);
      if (!path) return false;
      const locale = trackedLocale(body.locale, path);
      if (!locale) return false;

      const date = localDay(now, await this.settings.timeZone());
      await this.increment(date, path, locale);
      return true;
    } catch (error) {
      this.logger.warn(
        `Page view not recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async increment(
    date: Date,
    path: string,
    locale: 'ES' | 'EN',
  ): Promise<void> {
    const upsert = () =>
      this.prisma.pageView.upsert({
        where: { date_path_locale: { date, path, locale } },
        create: { date, path, locale, count: 1 },
        update: { count: { increment: 1 } },
      });
    try {
      await upsert();
    } catch (error) {
      // Two first views of the same page at once: the loser retries as an update.
      if (!isUniqueViolation(error)) throw error;
      await upsert();
    }
  }
}
