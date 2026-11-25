import { Inject, Injectable } from '@nestjs/common';
import { LOCALES } from '../../common/i18n/locale.js';
import type {
  IndexingRunStatus,
  KnowledgeSourceType,
  Locale,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  EMBEDDING_DIMENSION,
  EMBEDDINGS_PROVIDER,
  type EmbeddingsProvider,
} from './embeddings/embeddings-provider.js';
import {
  KnowledgeIndexerService,
  type PendingSource,
} from './knowledge-indexer.service.js';
import { KnowledgeSearchService } from './knowledge-search.service.js';

export const MAX_PENDING_ITEMS = 50;

export type KnowledgeState = 'SYNCED' | 'PENDING' | 'INDEXING';

export const KNOWLEDGE_STATE_LABELS: Record<KnowledgeState, string> = {
  SYNCED: 'Sincronizada',
  PENDING: 'Cambios pendientes',
  INDEXING: 'Indexando…',
};

export interface IndexingRunView {
  id: string;
  status: IndexingRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  sourcesCount: number;
  chunksCount: number;
  embeddedCount: number;
  removedCount: number;
  error: string | null;
}

export interface KnowledgeStatus {
  state: KnowledgeState;
  label: string;
  embeddingModel: string;
  dimension: number;
  embeddingsConfigured: boolean;
  minSimilarity: number;
  totals: { sources: number; chunks: number };
  counts: {
    sourceType: KnowledgeSourceType;
    locale: Locale;
    sources: number;
    chunks: number;
  }[];
  pending: { count: number; items: PendingSource[] };
  lastIndexedAt: Date | null;
  lastRun: IndexingRunView | null;
}

@Injectable()
export class KnowledgeStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: KnowledgeIndexerService,
    private readonly search: KnowledgeSearchService,
    @Inject(EMBEDDINGS_PROVIDER)
    private readonly embeddings: EmbeddingsProvider,
  ) {}

  async status(): Promise<KnowledgeStatus> {
    const [{ pending, stored }, lastRun] = await Promise.all([
      this.indexer.pendingSources(),
      this.prisma.indexingRun.findFirst({
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          sourcesCount: true,
          chunksCount: true,
          embeddedCount: true,
          removedCount: true,
          error: true,
        },
      }),
    ]);

    const counts = (['CASE', 'FAQ'] as const).flatMap((sourceType) =>
      LOCALES.map((locale) => {
        const rows = stored.filter(
          (row) => row.source_type === sourceType && row.locale === locale,
        );
        return {
          sourceType,
          locale,
          sources: new Set(rows.map((row) => row.source_id)).size,
          chunks: rows.length,
        };
      }),
    );
    let lastIndexedAt: Date | null = null;
    for (const row of stored) {
      if (!lastIndexedAt || row.updated_at > lastIndexedAt) {
        lastIndexedAt = row.updated_at;
      }
    }

    const state: KnowledgeState =
      lastRun?.status === 'RUNNING'
        ? 'INDEXING'
        : pending.length > 0
          ? 'PENDING'
          : 'SYNCED';
    return {
      state,
      label: KNOWLEDGE_STATE_LABELS[state],
      embeddingModel: this.embeddings.model,
      dimension: EMBEDDING_DIMENSION,
      embeddingsConfigured: this.embeddings.configured,
      minSimilarity: this.search.minSimilarity,
      totals: {
        sources: counts.reduce((sum, c) => sum + c.sources, 0),
        chunks: stored.length,
      },
      counts,
      pending: {
        count: pending.length,
        items: pending.slice(0, MAX_PENDING_ITEMS),
      },
      lastIndexedAt,
      lastRun,
    };
  }
}
