import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  aggregateUsage,
  AssistantUsageService,
  parseUsage,
  type UsageRow,
} from './assistant-usage.service.js';
import { estimateCostUsd, MODEL_PRICES } from './pricing.js';

const SONNET = 'claude-sonnet-5-5';

function usage(
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens = 0,
  cacheCreationInputTokens = 0,
  requests = 1,
) {
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    requests,
  };
}

const range = {
  days: 3,
  dates: ['2026-11-25', '2026-11-26', '2026-11-27'],
  timeZone: 'America/Lima',
};

describe('estimateCostUsd', () => {
  it('prices the four token buckets per million', () => {
    // 1M of each bucket: 2.00 + 10.00 + 0.10 + 2.50.
    expect(
      estimateCostUsd(SONNET, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
        cacheCreationInputTokens: 1_000_000,
      }),
    ).toBeCloseTo(14.6, 10);
  });

  it('returns null for a model without a price', () => {
    expect(estimateCostUsd('claude-mystery-9', usage(1000, 1000))).toBeNull();
  });

  it('keeps the contract prices', () => {
    expect(MODEL_PRICES[SONNET]).toEqual({
      input: 2,
      output: 10,
      cacheWrite: 2.5,
      cacheRead: 0.1,
    });
  });
});

describe('parseUsage', () => {
  it('reads token counts and ignores junk', () => {
    expect(parseUsage({ inputTokens: 5, outputTokens: 'x', requests: -1 })).toEqual(
      usage(5, 0, 0, 0, 0),
    );
    expect(parseUsage(null)).toBeNull();
    expect(parseUsage([1, 2])).toBeNull();
    expect(parseUsage('{}')).toBeNull();
  });
});

describe('aggregateUsage', () => {
  it('adds up mixed models, per day, with an unpriced model and cache hit rate', () => {
    const rows: UsageRow[] = [
      // Lima 2026-11-25 (UTC 11-26 03:00 is still 11-25 at 22:00 local).
      {
        conversationId: 'c1',
        createdAt: new Date('2026-11-26T03:00:00Z'),
        model: SONNET,
        usage: usage(1_000_000, 100_000, 500_000, 200_000, 2),
      },
      {
        conversationId: 'c1',
        createdAt: new Date('2026-11-26T03:10:00Z'),
        model: SONNET,
        usage: usage(500_000, 50_000, 0, 0, 1),
      },
      // 2026-11-27 local, another conversation, unpriced model.
      {
        conversationId: 'c2',
        createdAt: new Date('2026-11-27T15:00:00Z'),
        model: 'claude-future-1',
        usage: usage(300_000, 30_000, 100_000, 0, 1),
      },
      // A failed turn (usage null) is not counted.
      {
        conversationId: 'c3',
        createdAt: new Date('2026-11-27T16:00:00Z'),
        model: SONNET,
        usage: null,
      },
    ];

    const result = aggregateUsage(rows, range);

    // sonnet: input 1.5M*2 = 3.0; output 0.15M*10 = 1.5; read 0.5M*0.1 = 0.05; write 0.2M*2.5 = 0.5.
    expect(result.byModel).toEqual([
      {
        model: SONNET,
        requests: 3,
        inputTokens: 1_500_000,
        outputTokens: 150_000,
        cacheReadInputTokens: 500_000,
        cacheCreationInputTokens: 200_000,
        estimatedCostUsd: 5.05,
      },
      {
        model: 'claude-future-1',
        requests: 1,
        inputTokens: 300_000,
        outputTokens: 30_000,
        cacheReadInputTokens: 100_000,
        cacheCreationInputTokens: 0,
        estimatedCostUsd: 0,
      },
    ]);
    expect(result.unpricedModels).toEqual(['claude-future-1']);
    expect(result.totals).toEqual({
      conversations: 2,
      assistantMessages: 3,
      requests: 4,
      inputTokens: 1_800_000,
      outputTokens: 180_000,
      cacheReadInputTokens: 600_000,
      cacheCreationInputTokens: 200_000,
      // 600k / (1.8M + 600k + 200k)
      cacheHitRate: 0.2308,
      estimatedCostUsd: 5.05,
    });
    expect(result.perConversation).toEqual({
      avgCostUsd: 2.525,
      avgInputTokens: 900_000,
      avgOutputTokens: 90_000,
    });
    expect(result.series).toEqual([
      { date: '2026-11-25', conversations: 1, costUsd: 5.05 },
      { date: '2026-11-26', conversations: 0, costUsd: 0 },
      { date: '2026-11-27', conversations: 1, costUsd: 0 },
    ]);
    expect(result.range).toEqual({
      days: 3,
      from: '2026-11-25',
      to: '2026-11-27',
      timeZone: 'America/Lima',
    });
    expect(result.prices).toEqual(MODEL_PRICES);
  });

  it('treats a message without model as an unpriced "unknown" model', () => {
    const result = aggregateUsage(
      [
        {
          conversationId: 'c1',
          createdAt: new Date('2026-11-27T15:00:00Z'),
          model: null,
          usage: usage(10, 5),
        },
      ],
      range,
    );
    expect(result.unpricedModels).toEqual(['unknown']);
    expect(result.totals.estimatedCostUsd).toBe(0);
    expect(result.totals.inputTokens).toBe(10);
  });

  it('returns zeros, a zero-filled series and no division by zero for an empty period', () => {
    const result = aggregateUsage([], range);
    expect(result.totals).toEqual({
      conversations: 0,
      assistantMessages: 0,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheHitRate: 0,
      estimatedCostUsd: 0,
    });
    expect(result.perConversation).toEqual({
      avgCostUsd: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
    });
    expect(result.byModel).toEqual([]);
    expect(result.unpricedModels).toEqual([]);
    expect(result.series).toHaveLength(3);
  });
});

describe('AssistantUsageService', () => {
  it('reads only stored assistant messages of the period, in the site time zone', async () => {
    const prisma = {
      siteSettings: {
        findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Lima' }),
      },
      message: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new AssistantUsageService(prisma as unknown as PrismaService);

    const result = await service.usage(7, new Date('2026-11-27T20:00:00Z'));

    expect(result.range).toMatchObject({
      days: 7,
      from: '2026-11-21',
      to: '2026-11-27',
      timeZone: 'America/Lima',
    });
    expect(prisma.message.findMany).toHaveBeenCalledWith({
      where: {
        role: 'ASSISTANT',
        // 2026-11-21 00:00 in Lima (UTC-5).
        createdAt: { gte: new Date('2026-11-21T05:00:00.000Z') },
      },
      select: { conversationId: true, createdAt: true, model: true, usage: true },
    });
  });
});
