import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  AdminStatsService,
  normalizeQuestion,
  topQuestions,
} from './admin-stats.service.js';

describe('top questions', () => {
  it('groups questions that differ only in case, accents and punctuation', () => {
    expect(normalizeQuestion('¿Tienen experiencia con CONTADORES?')).toBe(
      'tienen experiencia con contadores',
    );
    expect(
      topQuestions([
        '¿Tienen experiencia con contadores?',
        'tienen experiencia con contadores',
        'Have you built an ecommerce?',
        '¿Tienen experiencia con contadóres?',
        '???',
      ]),
    ).toEqual([
      { question: '¿Tienen experiencia con contadores?', count: 3 },
      { question: 'Have you built an ecommerce?', count: 1 },
    ]);
  });
});

describe('AdminStatsService.overview', () => {
  it('builds a daily series in Lima time with zero-filled days', async () => {
    const prisma = {
      siteSettings: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Lima' }) },
      pageView: { aggregate: vi.fn().mockResolvedValue({ _sum: { count: null } }) },
      conversation: {
        findMany: vi.fn().mockResolvedValue([
          // 2026-11-24 23:30 in Lima (already the 25th in UTC).
          { createdAt: new Date('2026-11-25T04:30:00Z'), messages: [{ content: 'Hola' }] },
          { createdAt: new Date('2026-11-25T15:00:00Z'), messages: [{ content: 'hola' }] },
        ]),
      },
      lead: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ createdAt: new Date('2026-11-25T15:00:00Z') }])
          .mockResolvedValueOnce([]),
      },
      message: { count: vi.fn().mockResolvedValue(2) },
    };
    const service = new AdminStatsService(prisma as unknown as PrismaService);

    const overview = await service.overview(3, new Date('2026-11-25T18:00:00Z'));

    expect(overview.range).toEqual({
      days: 3,
      from: '2026-11-23',
      to: '2026-11-25',
      timeZone: 'America/Lima',
    });
    expect(overview.totals).toEqual({ visits: 0, conversations: 2, newLeads: 1, unanswered: 2 });
    expect(overview.series).toEqual([
      { date: '2026-11-23', conversations: 0, leads: 0 },
      { date: '2026-11-24', conversations: 1, leads: 0 },
      { date: '2026-11-25', conversations: 1, leads: 1 },
    ]);
    expect(overview.topQuestions).toEqual([{ question: 'Hola', count: 2 }]);
    // The range starts at midnight Lima time (05:00 UTC).
    expect(prisma.conversation.findMany.mock.calls[0][0].where.createdAt.gte).toEqual(
      new Date('2026-11-23T05:00:00Z'),
    );
  });
});
