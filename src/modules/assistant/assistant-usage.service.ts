import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { formatLocalDateTime } from '../calendar/time-zones.js';
import { dayRange, siteTimeZone } from '../stats/day-range.js';
import {
  estimateCostUsd,
  MODEL_PRICES,
  type ModelPrice,
  type TokenCounts,
} from './pricing.js';

export const DEFAULT_USAGE_DAYS = 30;
/** Model id of messages stored without one (counted, never priced). */
export const UNKNOWN_MODEL = 'unknown';

export interface UsageRow {
  conversationId: string;
  createdAt: Date;
  model: string | null;
  /** The `usage` JSON of the message (see TurnUsage). */
  usage: unknown;
}

export interface ModelUsage extends TokenCounts {
  model: string;
  requests: number;
  estimatedCostUsd: number;
}

export interface AssistantUsage {
  range: { days: number; from: string; to: string; timeZone: string };
  totals: TokenCounts & {
    conversations: number;
    assistantMessages: number;
    requests: number;
    cacheHitRate: number;
    estimatedCostUsd: number;
  };
  perConversation: {
    avgCostUsd: number;
    avgInputTokens: number;
    avgOutputTokens: number;
  };
  byModel: ModelUsage[];
  series: { date: string; conversations: number; costUsd: number }[];
  prices: Record<string, ModelPrice>;
  unpricedModels: string[];
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/** Reads a stored `usage` JSON; null when it has no token counts at all. */
export function parseUsage(
  usage: unknown,
): (TokenCounts & { requests: number }) | null {
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) {
    return null;
  }
  const u = usage as Record<string, unknown>;
  return {
    inputTokens: count(u.inputTokens),
    outputTokens: count(u.outputTokens),
    cacheReadInputTokens: count(u.cacheReadInputTokens),
    cacheCreationInputTokens: count(u.cacheCreationInputTokens),
    requests: count(u.requests),
  };
}

/** Pure aggregation of the assistant messages of the period. */
export function aggregateUsage(
  rows: readonly UsageRow[],
  range: { days: number; dates: string[]; timeZone: string },
  prices: Readonly<Record<string, ModelPrice>> = MODEL_PRICES,
): AssistantUsage {
  const byModel = new Map<string, ModelUsage>();
  const series = new Map(
    range.dates.map((date) => [
      date,
      { date, conversations: 0, costUsd: 0 },
    ]),
  );
  // A conversation counts on the day of its first message of the period.
  const conversations = new Map<string, string>();
  let assistantMessages = 0;
  const sorted = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  for (const row of sorted) {
    const usage = parseUsage(row.usage);
    if (!usage) continue;
    assistantMessages++;
    const model = row.model ?? UNKNOWN_MODEL;
    const entry = byModel.get(model) ?? {
      model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      estimatedCostUsd: 0,
    };
    entry.requests += usage.requests;
    entry.inputTokens += usage.inputTokens;
    entry.outputTokens += usage.outputTokens;
    entry.cacheReadInputTokens += usage.cacheReadInputTokens;
    entry.cacheCreationInputTokens += usage.cacheCreationInputTokens;
    byModel.set(model, entry);

    const day = formatLocalDateTime(row.createdAt, range.timeZone).slice(0, 10);
    const bucket = series.get(day);
    if (!conversations.has(row.conversationId)) {
      conversations.set(row.conversationId, day);
      if (bucket) bucket.conversations++;
    }
    const cost = estimateCostUsd(model, usage, prices);
    if (cost !== null) {
      entry.estimatedCostUsd += cost;
      if (bucket) bucket.costUsd += cost;
    }
  }

  const models = [...byModel.values()].sort(
    (a, b) =>
      b.estimatedCostUsd - a.estimatedCostUsd || a.model.localeCompare(b.model),
  );
  const sum = (pick: (m: ModelUsage) => number) =>
    models.reduce((total, m) => total + pick(m), 0);
  const inputTokens = sum((m) => m.inputTokens);
  const outputTokens = sum((m) => m.outputTokens);
  const cacheReadInputTokens = sum((m) => m.cacheReadInputTokens);
  const cacheCreationInputTokens = sum((m) => m.cacheCreationInputTokens);
  const estimatedCostUsd = sum((m) => m.estimatedCostUsd);
  const promptTokens =
    inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
  const conversationCount = conversations.size;
  const average = (total: number) =>
    conversationCount === 0 ? 0 : total / conversationCount;

  return {
    range: {
      days: range.days,
      from: range.dates[0],
      to: range.dates[range.dates.length - 1],
      timeZone: range.timeZone,
    },
    totals: {
      conversations: conversationCount,
      assistantMessages,
      requests: sum((m) => m.requests),
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      cacheHitRate:
        promptTokens === 0 ? 0 : round(cacheReadInputTokens / promptTokens, 4),
      estimatedCostUsd: round(estimatedCostUsd, 6),
    },
    perConversation: {
      avgCostUsd: round(average(estimatedCostUsd), 6),
      avgInputTokens: Math.round(average(inputTokens)),
      avgOutputTokens: Math.round(average(outputTokens)),
    },
    byModel: models.map((m) => ({
      ...m,
      estimatedCostUsd: round(m.estimatedCostUsd, 6),
    })),
    series: [...series.values()].map((s) => ({
      ...s,
      costUsd: round(s.costUsd, 6),
    })),
    prices: { ...prices },
    unpricedModels: models
      .filter((m) => !prices[m.model])
      .map((m) => m.model)
      .sort(),
  };
}

/**
 * Token usage and estimated cost of the public chat (GET /admin/assistant/usage).
 * Only stored assistant messages count: admin test answers are never persisted,
 * and Voyage embeddings are not part of it.
 */
@Injectable()
export class AssistantUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async usage(
    days: number = DEFAULT_USAGE_DAYS,
    now: Date = new Date(),
  ): Promise<AssistantUsage> {
    const range = dayRange(days, now, await siteTimeZone(this.prisma));
    const rows = await this.prisma.message.findMany({
      where: { role: 'ASSISTANT', createdAt: { gte: range.fromUtc } },
      select: {
        conversationId: true,
        createdAt: true,
        model: true,
        usage: true,
      },
    });
    return aggregateUsage(rows, { days, ...range });
  }
}
