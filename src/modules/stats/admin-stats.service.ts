import { Injectable } from '@nestjs/common';
import type { LeadSource, LeadStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { formatLocalDateTime } from '../calendar/time-zones.js';
import { dayRange, siteTimeZone } from './day-range.js';

export const DEFAULT_OVERVIEW_DAYS = 30;
const TOP_QUESTIONS = 5;
const LATEST_LEADS = 5;
const TOP_PAGES = 5;

export interface StatsOverview {
  range: { days: number; from: string; to: string; timeZone: string };
  totals: {
    /** Sum of the PageView counts of the period (POST /track). */
    visits: number;
    conversations: number;
    newLeads: number;
    /** Visitor questions marked "sin respuesta". */
    unanswered: number;
  };
  /** One entry per local day, oldest first (days without activity included). */
  series: {
    date: string;
    visits: number;
    conversations: number;
    leads: number;
  }[];
  topQuestions: { question: string; count: number }[];
  /** The paths with the most visits in the period (both locales). */
  topPages: { path: string; visits: number }[];
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
    const { timeZone, dates, fromUtc } = dayRange(
      days,
      now,
      await siteTimeZone(this.prisma),
    );

    // PageView.date is the local day stored as UTC midnight (DATE column).
    const visitsWhere = {
      date: {
        gte: new Date(`${dates[0]}T00:00:00.000Z`),
        lte: new Date(`${dates[dates.length - 1]}T00:00:00.000Z`),
      },
    };
    const [visitsByDay, visitsByPath, conversations, leads, unanswered, latestLeads] =
      await Promise.all([
        this.prisma.pageView.groupBy({
          by: ['date'],
          where: visitsWhere,
          _sum: { count: true },
        }),
        this.prisma.pageView.groupBy({
          by: ['path'],
          where: visitsWhere,
          _sum: { count: true },
          orderBy: [{ _sum: { count: 'desc' } }, { path: 'asc' }],
          take: TOP_PAGES,
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
      dates.map((date) => [
        date,
        { date, visits: 0, conversations: 0, leads: 0 },
      ]),
    );
    let visits = 0;
    for (const row of visitsByDay) {
      const count = row._sum.count ?? 0;
      visits += count;
      const entry = series.get(row.date.toISOString().slice(0, 10));
      if (entry) entry.visits += count;
    }
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
        visits,
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
      topPages: visitsByPath.map((row) => ({
        path: row.path,
        visits: row._sum.count ?? 0,
      })),
      latestLeads,
    };
  }
}
