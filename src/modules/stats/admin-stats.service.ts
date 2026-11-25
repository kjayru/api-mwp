import { Injectable } from '@nestjs/common';
import type { LeadSource, LeadStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  formatLocalDateTime,
  isValidTimeZone,
  zonedParts,
  zonedTimeToUtc,
} from '../calendar/time-zones.js';

export const DEFAULT_OVERVIEW_DAYS = 30;
const TOP_QUESTIONS = 5;
const LATEST_LEADS = 5;
const DEFAULT_TIME_ZONE = 'America/Lima';

export interface StatsOverview {
  range: { days: number; from: string; to: string; timeZone: string };
  totals: {
    /** Sum of PageView counts (0 until the front records visits). */
    visits: number;
    conversations: number;
    newLeads: number;
    /** Visitor questions marked "sin respuesta". */
    unanswered: number;
  };
  /** One entry per local day, oldest first (days without activity included). */
  series: { date: string; conversations: number; leads: number }[];
  topQuestions: { question: string; count: number }[];
  latestLeads: {
    id: string;
    name: string;
    email: string;
    source: LeadSource;
    status: LeadStatus;
    interest: string | null;
    createdAt: Date;
  }[];
}

/** "¿Tienen experiencia con contadores?" and "tienen experiencia con contadores" count as one. */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function topQuestions(
  questions: string[],
  limit = TOP_QUESTIONS,
): { question: string; count: number }[] {
  const groups = new Map<string, { question: string; count: number }>();
  for (const question of questions) {
    const key = normalizeQuestion(question);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { question: question.trim().slice(0, 300), count: 1 });
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Dashboard KPIs of the admin (GET /admin/stats/overview). */
@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(days: number, now: Date = new Date()): Promise<StatsOverview> {
    const settings = await this.prisma.siteSettings.findUnique({
      where: { id: 'default' },
      select: { timezone: true },
    });
    const timeZone =
      settings?.timezone && isValidTimeZone(settings.timezone)
        ? settings.timezone
        : DEFAULT_TIME_ZONE;

    const today = zonedParts(now, timeZone);
    const dates: string[] = [];
    for (let offset = days - 1; offset >= 0; offset--) {
      const day = new Date(Date.UTC(today.year, today.month - 1, today.day - offset));
      dates.push(day.toISOString().slice(0, 10));
    }
    const [fromYear, fromMonth, fromDay] = dates[0].split('-').map(Number);
    const fromUtc =
      zonedTimeToUtc(
        { year: fromYear, month: fromMonth, day: fromDay, hour: 0, minute: 0 },
        timeZone,
      ) ?? new Date(Date.UTC(fromYear, fromMonth - 1, fromDay));

    const [visits, conversations, leads, unanswered, latestLeads] =
      await Promise.all([
        this.prisma.pageView.aggregate({
          where: { date: { gte: new Date(`${dates[0]}T00:00:00.000Z`) } },
          _sum: { count: true },
        }),
        this.prisma.conversation.findMany({
          where: { createdAt: { gte: fromUtc } },
          select: {
            createdAt: true,
            messages: {
              where: { role: 'USER' },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 1,
              select: { content: true },
            },
          },
        }),
        this.prisma.lead.findMany({
          where: { createdAt: { gte: fromUtc }, deletedAt: null },
          select: { createdAt: true },
        }),
        this.prisma.message.count({
          where: { role: 'USER', unanswered: true, createdAt: { gte: fromUtc } },
        }),
        this.prisma.lead.findMany({
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: LATEST_LEADS,
          select: {
            id: true,
            name: true,
            email: true,
            source: true,
            status: true,
            interest: true,
            createdAt: true,
          },
        }),
      ]);

    const localDay = (date: Date) => formatLocalDateTime(date, timeZone).slice(0, 10);
    const series = new Map(
      dates.map((date) => [date, { date, conversations: 0, leads: 0 }]),
    );
    for (const row of conversations) {
      const entry = series.get(localDay(row.createdAt));
      if (entry) entry.conversations++;
    }
    for (const row of leads) {
      const entry = series.get(localDay(row.createdAt));
      if (entry) entry.leads++;
    }

    return {
      range: { days, from: dates[0], to: dates[dates.length - 1], timeZone },
      totals: {
        visits: visits._sum.count ?? 0,
        conversations: conversations.length,
        newLeads: leads.length,
        unanswered,
      },
      series: [...series.values()],
      topQuestions: topQuestions(
        conversations
          .map((row) => row.messages[0]?.content)
          .filter((content): content is string => Boolean(content)),
      ),
      latestLeads,
    };
  }
}
