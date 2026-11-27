import type { PrismaService } from '../../prisma/prisma.service.js';
import { EMBEDDING_DIMENSION } from './embeddings/embeddings-provider.js';
import { KnowledgeIndexerService } from './knowledge-indexer.service.js';
import { planAll } from './knowledge-sources.js';

vi.mock('./knowledge-sources.js', () => ({
  planSource: vi.fn(),
  planAll: vi.fn(),
}));

const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0.1);

function planned(chunks: { key: string; hash: string }[]) {
  return [
    {
      sourceType: 'CASE' as const,
      sourceId: 'case-1',
      locale: 'ES' as const,
      title: 'Caso',
      chunks: chunks.map(({ key, hash }, chunkIndex) => ({
        chunkIndex,
        sourceKey: key,
        title: 'Caso',
        url: '/es/casos/caso',
        content: `texto ${hash}`,
        contentHash: hash,
        tokenCount: 3,
        caseType: 'SAAS' as const,
        technologies: [],
      })),
    },
  ];
}

const stored = (
  over: Partial<{
    id: string;
    source_type: 'CASE' | 'FAQ';
    source_id: string;
    locale: 'ES' | 'EN';
    source_key: string;
    content_hash: string;
    embedding_model: string;
    has_embedding: boolean;
    title: string;
  }> = {},
) => ({
  id: 'row-1',
  source_type: 'CASE' as const,
  source_id: 'case-1',
  locale: 'ES' as const,
  source_key: 'caso:caso#0',
  content_hash: 'h1',
  embedding_model: 'voyage-3.5',
  has_embedding: true,
  title: 'Caso',
  updated_at: new Date(),
  ...over,
});

describe('KnowledgeIndexerService (pending sources and full reindex)', () => {
  const tx = {
    knowledgeChunk: {
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      createManyAndReturn: vi.fn(),
    },
    $executeRaw: vi.fn(),
  };
  const prisma = {
    $queryRaw: vi.fn(),
    knowledgeChunk: { deleteMany: vi.fn() },
    indexingRun: { update: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const embeddings = { model: 'voyage-3.5', configured: true, embed: vi.fn() };
  let indexer: KnowledgeIndexerService;

  beforeEach(() => {
    vi.clearAllMocks();
    indexer = new KnowledgeIndexerService(
      prisma as unknown as PrismaService,
      embeddings,
    );
    tx.knowledgeChunk.createManyAndReturn.mockImplementation(
      async ({ data }: { data: { locale: string; sourceKey: string }[] }) =>
        data.map((d, i) => ({
          id: `new-${i}`,
          locale: d.locale,
          sourceKey: d.sourceKey,
        })),
    );
    prisma.knowledgeChunk.deleteMany.mockResolvedValue({ count: 0 });
  });

  describe('indexedChunks', () => {
    it('returns the rows of the query, with or without a source filter', async () => {
      prisma.$queryRaw.mockResolvedValue([stored()]);
      expect(await indexer.indexedChunks()).toHaveLength(1);
      expect(await indexer.indexedChunks('CASE', 'case-1')).toHaveLength(1);
      expect(await indexer.indexedChunks('CASE')).toHaveLength(1);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    });
  });

  describe('pendingSources', () => {
    it('reports nothing when stored chunks match the plan', async () => {
      vi.mocked(planAll).mockResolvedValue(
        planned([{ key: 'caso:caso#0', hash: 'h1' }]),
      );
      prisma.$queryRaw.mockResolvedValue([stored()]);

      const { pending, stored: rows } = await indexer.pendingSources();

      expect(pending).toEqual([]);
      expect(rows).toHaveLength(1);
    });

    it('marks never-indexed sources as new', async () => {
      vi.mocked(planAll).mockResolvedValue(
        planned([{ key: 'caso:caso#0', hash: 'h1' }]),
      );
      prisma.$queryRaw.mockResolvedValue([]);

      const { pending } = await indexer.pendingSources();

      expect(pending).toEqual([
        {
          sourceType: 'CASE',
          sourceId: 'case-1',
          locale: 'ES',
          title: 'Caso',
          reason: 'new',
        },
      ]);
    });

    it.each([
      ['a different hash', { content_hash: 'old' }],
      ['another embedding model', { embedding_model: 'voyage-3.5-lite' }],
      ['a missing embedding', { has_embedding: false }],
    ])('marks as changed a source with %s', async (_name, over) => {
      vi.mocked(planAll).mockResolvedValue(
        planned([{ key: 'caso:caso#0', hash: 'h1' }]),
      );
      prisma.$queryRaw.mockResolvedValue([stored(over)]);

      const { pending } = await indexer.pendingSources();

      expect(pending).toHaveLength(1);
      expect(pending[0].reason).toBe('changed');
    });

    it('marks as changed when the stored chunk count differs from the plan', async () => {
      vi.mocked(planAll).mockResolvedValue(
        planned([{ key: 'caso:caso#0', hash: 'h1' }]),
      );
      prisma.$queryRaw.mockResolvedValue([
        stored(),
        stored({ id: 'row-2', source_key: 'caso:caso#1', content_hash: 'h2' }),
      ]);
      expect((await indexer.pendingSources()).pending[0].reason).toBe(
        'changed',
      );
    });

    it('marks stored sources that are no longer planned as removed', async () => {
      vi.mocked(planAll).mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([
        stored({ source_type: 'FAQ', source_id: 'faq-9', title: 'Vieja' }),
      ]);

      const { pending } = await indexer.pendingSources();

      expect(pending).toEqual([
        {
          sourceType: 'FAQ',
          sourceId: 'faq-9',
          locale: 'ES',
          title: 'Vieja',
          reason: 'removed',
        },
      ]);
    });
  });

  describe('runFullReindex', () => {
    it('embeds all changes in one call, writes each source and records the run as SUCCEEDED', async () => {
      vi.mocked(planAll).mockResolvedValue([
        ...planned([
          { key: 'caso:caso#0', hash: 'same' },
          { key: 'caso:caso#1', hash: 'new' },
        ]),
        {
          ...planned([{ key: 'faq:f#0', hash: 'f1' }])[0],
          sourceType: 'FAQ' as const,
          sourceId: 'faq-1',
        },
      ]);
      prisma.$queryRaw
        // indexedChunks of case-1, then faq-1
        .mockResolvedValueOnce([stored({ id: 'old-0', content_hash: 'same' })])
        .mockResolvedValueOnce([])
        // distinct stored sources
        .mockResolvedValueOnce([
          { source_type: 'CASE', source_id: 'case-1' },
          { source_type: 'FAQ', source_id: 'faq-1' },
          { source_type: 'CASE', source_id: 'orphan' },
        ]);
      prisma.knowledgeChunk.deleteMany.mockResolvedValue({ count: 2 });
      embeddings.embed.mockResolvedValue([vector, vector]);

      await indexer.runFullReindex('run-1');

      expect(embeddings.embed).toHaveBeenCalledTimes(1);
      expect(embeddings.embed.mock.calls[0][0]).toEqual([
        'texto new',
        'texto f1',
      ]);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(prisma.knowledgeChunk.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
        where: { sourceType: 'CASE', sourceId: 'orphan' },
      });
      expect(prisma.indexingRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: 'SUCCEEDED',
          // planned entries (case-1 ES with 2 chunks, faq-1 ES with 1)
          sourcesCount: 2,
          chunksCount: 3,
          embeddedCount: 2,
          // case-1 had 1 stored chunk and kept it: 0 removed; faq 0; orphan 2
          removedCount: 2,
        }),
      });
    });

    it('does not call the embeddings provider when nothing changed', async () => {
      vi.mocked(planAll).mockResolvedValue(
        planned([{ key: 'caso:caso#0', hash: 'h1' }]),
      );
      prisma.$queryRaw
        .mockResolvedValueOnce([stored()])
        .mockResolvedValueOnce([{ source_type: 'CASE', source_id: 'case-1' }]);

      await indexer.runFullReindex('run-2');

      expect(embeddings.embed).not.toHaveBeenCalled();
      expect(prisma.indexingRun.update.mock.calls[0][0].data).toMatchObject({
        status: 'SUCCEEDED',
        embeddedCount: 0,
        removedCount: 0,
      });
    });

    it('records the failure on the run (message truncated) instead of throwing', async () => {
      vi.mocked(planAll).mockRejectedValue(new Error('x'.repeat(2000)));

      await expect(indexer.runFullReindex('run-3')).resolves.toBeUndefined();

      const data = prisma.indexingRun.update.mock.calls[0][0].data;
      expect(data.status).toBe('FAILED');
      expect(data.error).toHaveLength(1000);
    });

    it('records non-Error failures too', async () => {
      vi.mocked(planAll).mockRejectedValue('plain string');
      await indexer.runFullReindex('run-4');
      expect(prisma.indexingRun.update.mock.calls[0][0].data.error).toBe(
        'plain string',
      );
    });
  });
});
