import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  type BusinessHours,
  candidateStarts,
  DEFAULT_BUSINESS_HOURS,
  firstFreeSlots,
  fitsBusinessHours,
  type Interval,
  isFree,
  parseBusinessHours,
} from './business-hours.js';
import {
  CALENDAR_PROVIDER,
  type CalendarProvider,
} from './calendar-provider.js';
import { isValidTimeZone } from './time-zones.js';

/** A meeting needs at least this much notice. */
export const MEETING_MIN_NOTICE_MINUTES = 120;
/** And can be at most this far ahead. */
export const MEETING_MAX_DAYS_AHEAD = 60;
/** Alternatives are searched over this many days after the requested time. */
export const ALTERNATIVES_SEARCH_DAYS = 14;
export const MAX_ALTERNATIVES = 3;
const DEFAULT_TIME_ZONE = 'America/Lima';
const DEFAULT_DURATION_MINUTES = 30;

export interface SchedulingSettings {
  hours: BusinessHours;
  /** Studio time zone (SiteSettings.timezone). */
  timeZone: string;
  durationMinutes: number;
}

export interface ScheduleRequest {
  conversationId: string;
  leadId: string;
  name: string;
  email: string;
  start: Date;
  /** IANA zone of the visitor. */
  visitorTimeZone: string;
  reason: string;
}

export type UnavailableReason =
  | 'outside_hours'
  | 'busy'
  | 'too_soon'
  | 'too_far';

export type ScheduleOutcome =
  | {
      status: 'BOOKED';
      meetingId: string;
      start: Date;
      end: Date;
      meetLink: string | null;
    }
  | {
      status: 'REQUESTED';
      meetingId: string;
      start: Date;
      end: Date;
      /** True when Google Calendar is configured but failed. */
      calendarFailed: boolean;
    }
  | {
      status: 'UNAVAILABLE';
      reason: UnavailableReason;
      alternatives: Date[];
    }
  | {
      status: 'ALREADY_BOOKED';
      meetingId: string;
      start: Date;
      end: Date;
      meetLink: string | null;
    };

/**
 * agendar_reunion: checks business hours and (with Google Calendar) the free
 * slots of the studio's primary calendar, then books the call or proposes
 * alternatives. Never returns busy intervals, only free slots.
 */
@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CALENDAR_PROVIDER) private readonly calendar: CalendarProvider,
  ) {}

  async settings(): Promise<SchedulingSettings> {
    const row = await this.prisma.siteSettings.findUnique({
      where: { id: 'default' },
      select: {
        businessHours: true,
        timezone: true,
        meetingDurationMinutes: true,
      },
    });
    return {
      hours: row ? parseBusinessHours(row.businessHours) : DEFAULT_BUSINESS_HOURS,
      timeZone:
        row?.timezone && isValidTimeZone(row.timezone)
          ? row.timezone
          : DEFAULT_TIME_ZONE,
      durationMinutes:
        row && row.meetingDurationMinutes > 0
          ? row.meetingDurationMinutes
          : DEFAULT_DURATION_MINUTES,
    };
  }

  async schedule(
    request: ScheduleRequest,
    now: Date = new Date(),
  ): Promise<ScheduleOutcome> {
    const settings = await this.settings();
    const { hours, timeZone, durationMinutes } = settings;

    const booked = await this.prisma.meeting.findFirst({
      where: {
        conversationId: request.conversationId,
        status: 'BOOKED',
        start: { gt: now },
      },
      orderBy: { start: 'asc' },
    });
    if (booked) {
      return {
        status: 'ALREADY_BOOKED',
        meetingId: booked.id,
        start: booked.start,
        end: booked.end,
        meetLink: booked.meetLink,
      };
    }

    const start = request.start;
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const earliest = new Date(now.getTime() + MEETING_MIN_NOTICE_MINUTES * 60_000);
    const latest = new Date(now.getTime() + MEETING_MAX_DAYS_AHEAD * 86_400_000);

    let reason: UnavailableReason | null = null;
    if (start < earliest) reason = 'too_soon';
    else if (start > latest) reason = 'too_far';
    else if (!fitsBusinessHours(start, durationMinutes, hours, timeZone)) {
      reason = 'outside_hours';
    }
    const searchFrom = reason === 'too_soon' || reason === 'too_far' ? earliest : start;
    const candidates = candidateStarts(
      searchFrom,
      ALTERNATIVES_SEARCH_DAYS,
      durationMinutes,
      hours,
      timeZone,
    ).filter((candidate) => candidate <= latest);

    if (!this.calendar.configured) {
      if (reason) {
        return {
          status: 'UNAVAILABLE',
          reason,
          alternatives: candidates.slice(0, MAX_ALTERNATIVES),
        };
      }
      return this.request(request, start, end, false);
    }

    let busy: Interval[];
    try {
      const windowEnd = new Date(
        Math.max(end.getTime(), searchFrom.getTime()) +
          (ALTERNATIVES_SEARCH_DAYS + 1) * 86_400_000,
      );
      busy = await this.calendar.busyIntervals(
        new Date(Math.min(start.getTime(), searchFrom.getTime())),
        windowEnd,
      );
    } catch (error) {
      this.logger.warn(
        `Google Calendar freeBusy failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (reason) {
        return {
          status: 'UNAVAILABLE',
          reason,
          alternatives: candidates.slice(0, MAX_ALTERNATIVES),
        };
      }
      return this.request(request, start, end, true);
    }

    if (!reason && !isFree({ start, end }, busy)) reason = 'busy';
    if (reason) {
      return {
        status: 'UNAVAILABLE',
        reason,
        alternatives: firstFreeSlots(
          candidates,
          durationMinutes,
          busy,
          MAX_ALTERNATIVES,
        ),
      };
    }

    try {
      const event = await this.calendar.createEvent({
        summary: `Llamada con ${request.name} · miwebprofesional`,
        description: [
          `Motivo: ${request.reason}`,
          `Visitante: ${request.name} <${request.email}>`,
          `Zona horaria del visitante: ${request.visitorTimeZone}`,
          `Agendada por el asistente IA (conversación ${request.conversationId}).`,
        ].join('\n'),
        start,
        end,
        timeZone,
        attendee: { email: request.email, name: request.name },
        requestId: `${request.conversationId}-${start.getTime()}`,
      });
      const meeting = await this.prisma.meeting.create({
        data: {
          leadId: request.leadId,
          conversationId: request.conversationId,
          googleEventId: event.eventId,
          start,
          end,
          timezone: request.visitorTimeZone,
          meetLink: event.meetLink,
          status: 'BOOKED',
        },
      });
      // A pending request of this conversation is now superseded.
      await this.prisma.meeting.updateMany({
        where: {
          conversationId: request.conversationId,
          status: 'REQUESTED',
        },
        data: { status: 'CANCELLED' },
      });
      return {
        status: 'BOOKED',
        meetingId: meeting.id,
        start,
        end,
        meetLink: event.meetLink,
      };
    } catch (error) {
      this.logger.warn(
        `Google Calendar events.insert failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.request(request, start, end, true);
    }
  }

  /** REQUESTED meeting (one per conversation: a new request replaces the time). */
  private async request(
    request: ScheduleRequest,
    start: Date,
    end: Date,
    calendarFailed: boolean,
  ): Promise<ScheduleOutcome> {
    const existing = await this.prisma.meeting.findFirst({
      where: { conversationId: request.conversationId, status: 'REQUESTED' },
    });
    const data = {
      leadId: request.leadId,
      start,
      end,
      timezone: request.visitorTimeZone,
    };
    const meeting = existing
      ? await this.prisma.meeting.update({ where: { id: existing.id }, data })
      : await this.prisma.meeting.create({
          data: {
            ...data,
            conversationId: request.conversationId,
            status: 'REQUESTED',
          },
        });
    return {
      status: 'REQUESTED',
      meetingId: meeting.id,
      start,
      end,
      calendarFailed,
    };
  }
}
