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
      pageView: {
        groupBy: vi
          .fn()
          // By day.
          .mockResolvedValueOnce([
            { date: new Date('2026-11-23T00:00:00Z'), _sum: { count: 4 } },
            { date: new Date('2026-11-25T00:00:00Z'), _sum: { count: 3 } },
          ])
          // By path (already sorted and limited by the database).
          .mockResolvedValueOnce([
            { path: '/es', _sum: { count: 5 } },
            { path: '/es/casos/contaflow-ia', _sum: { count: 2 } },
          ]),
      },
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
    expect(overview.totals).toEqual({ visits: 7, conversations: 2, newLeads: 1, unanswered: 2 });
    expect(overview.series).toEqual([
      { date: '2026-11-23', visits: 4, conversations: 0, leads: 0 },
      { date: '2026-11-24', visits: 0, conversations: 1, leads: 0 },
      { date: '2026-11-25', visits: 3, conversations: 1, leads: 1 },
    ]);
    expect(overview.topPages).toEqual([
      { path: '/es', visits: 5 },
      { path: '/es/casos/contaflow-ia', visits: 2 },
    ]);
    // Visits are filtered by local day (DATE column) and grouped per path, top 5.
    const [byDay, byPath] = prisma.pageView.groupBy.mock.calls.map((call) => call[0]);
    expect(byDay.where.date).toEqual({
      gte: new Date('2026-11-23T00:00:00Z'),
      lte: new Date('2026-11-25T00:00:00Z'),
    });
    expect(byPath).toMatchObject({ by: ['path'], take: 5 });
    expect(overview.topQuestions).toEqual([{ question: 'Hola', count: 2 }]);
    // The range starts at midnight Lima time (05:00 UTC).
    expect(prisma.conversation.findMany.mock.calls[0][0].where.createdAt.gte).toEqual(
      new Date('2026-11-23T05:00:00Z'),
    );
  });
});
