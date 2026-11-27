import type { PrismaService } from '../../prisma/prisma.service.js';
import { EMBEDDING_DIMENSION } from './embeddings/embeddings-provider.js';
import type { KnowledgeIndexerService } from './knowledge-indexer.service.js';
import type { KnowledgeSearchService } from './knowledge-search.service.js';
import {
  KNOWLEDGE_STATE_LABELS,
  KnowledgeStatusService,
  MAX_PENDING_ITEMS,
} from './knowledge-status.service.js';

const row = (
  type: 'CASE' | 'FAQ',
  id: string,
  locale: 'ES' | 'EN',
  updated: string,
) => ({
  id: `${type}-${id}-${locale}-${updated}`,
  source_type: type,
  source_id: id,
  locale,
  updated_at: new Date(updated),
});

describe('KnowledgeStatusService', () => {
  const indexer = { pendingSources: vi.fn() };
  const prisma = { indexingRun: { findFirst: vi.fn() } };
  const search = { minSimilarity: 0.4 };
  const embeddings = { model: 'voyage-3.5', configured: true, embed: vi.fn() };
  let service: KnowledgeStatusService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.indexingRun.findFirst.mockResolvedValue(null);
    service = new KnowledgeStatusService(
      prisma as unknown as PrismaService,
      indexer as unknown as KnowledgeIndexerService,
      search as unknown as KnowledgeSearchService,
      embeddings,
    );
  });

  it('is SYNCED and empty with nothing stored or pending', async () => {
    indexer.pendingSources.mockResolvedValue({ pending: [], stored: [] });

    const status = await service.status();

    expect(status).toMatchObject({
      state: 'SYNCED',
      label: KNOWLEDGE_STATE_LABELS.SYNCED,
      embeddingModel: 'voyage-3.5',
      dimension: EMBEDDING_DIMENSION,
      embeddingsConfigured: true,
      minSimilarity: 0.4,
      totals: { sources: 0, chunks: 0 },
      pending: { count: 0, items: [] },
      lastIndexedAt: null,
      lastRun: null,
    });
    expect(status.counts).toHaveLength(4);
    expect(status.counts.every((c) => c.sources === 0 && c.chunks === 0)).toBe(
      true,
    );
  });

  it('counts distinct sources and chunks per type and locale, and finds the latest update', async () => {
    indexer.pendingSources.mockResolvedValue({
      pending: [],
      stored: [
        row('CASE', 'a', 'ES', '2026-11-01T00:00:00Z'),
        row('CASE', 'a', 'ES', '2026-11-03T00:00:00Z'),
        row('CASE', 'b', 'ES', '2026-11-02T00:00:00Z'),
        row('FAQ', 'f', 'EN', '2026-11-01T00:00:00Z'),
      ],
    });

    const status = await service.status();

    const find = (t: string, l: string) =>
      status.counts.find((c) => c.sourceType === t && c.locale === l);
    expect(find('CASE', 'ES')).toMatchObject({ sources: 2, chunks: 3 });
    expect(find('FAQ', 'EN')).toMatchObject({ sources: 1, chunks: 1 });
    expect(find('CASE', 'EN')).toMatchObject({ sources: 0, chunks: 0 });
    expect(status.totals).toEqual({ sources: 3, chunks: 4 });
    expect(status.lastIndexedAt).toEqual(new Date('2026-11-03T00:00:00Z'));
  });

  it('is PENDING when there are pending sources and caps the listed items', async () => {
    const pending = Array.from({ length: MAX_PENDING_ITEMS + 5 }, (_, i) => ({
      sourceType: 'CASE',
      sourceId: `c${i}`,
      locale: 'ES',
      title: `T${i}`,
      reason: 'new',
    }));
    indexer.pendingSources.mockResolvedValue({ pending, stored: [] });

    const status = await service.status();

    expect(status.state).toBe('PENDING');
    expect(status.label).toBe(KNOWLEDGE_STATE_LABELS.PENDING);
    expect(status.pending.count).toBe(MAX_PENDING_ITEMS + 5);
    expect(status.pending.items).toHaveLength(MAX_PENDING_ITEMS);
  });

  it('is INDEXING while the last run is RUNNING, even with pending changes', async () => {
    const run = {
      id: 'r1',
      status: 'RUNNING',
      startedAt: new Date(),
      finishedAt: null,
      sourcesCount: 0,
      chunksCount: 0,
      embeddedCount: 0,
      removedCount: 0,
      error: null,
    };
    prisma.indexingRun.findFirst.mockResolvedValue(run);
    indexer.pendingSources.mockResolvedValue({
      pending: [{ sourceId: 'x' }],
      stored: [],
    });

    const status = await service.status();

    expect(status.state).toBe('INDEXING');
    expect(status.lastRun).toBe(run);
  });

  it('is not INDEXING when the last run failed', async () => {
    prisma.indexingRun.findFirst.mockResolvedValue({ status: 'FAILED' });
    indexer.pendingSources.mockResolvedValue({ pending: [], stored: [] });
    expect((await service.status()).state).toBe('SYNCED');
  });
});
