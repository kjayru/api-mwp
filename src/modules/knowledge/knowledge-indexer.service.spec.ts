import type { PrismaService } from '../../prisma/prisma.service.js';
import { EMBEDDING_DIMENSION } from './embeddings/embeddings-provider.js';
import { KnowledgeIndexerService } from './knowledge-indexer.service.js';
import { planSource } from './knowledge-sources.js';

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

describe('KnowledgeIndexerService.syncSource', () => {
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
        data.map((d, i) => ({ id: `new-${i}`, locale: d.locale, sourceKey: d.sourceKey })),
    );
  });

  it('keeps unchanged chunks and only embeds the changed ones', async () => {
    vi.mocked(planSource).mockResolvedValue(
      planned([
        { key: 'caso:caso#0', hash: 'same' },
        { key: 'caso:caso#1', hash: 'changed' },
      ]),
    );
    prisma.$queryRaw.mockResolvedValue([
      { id: 'old-0', locale: 'ES', source_key: 'caso:caso#0', content_hash: 'same', embedding_model: 'voyage-3.5', has_embedding: true },
      { id: 'old-1', locale: 'ES', source_key: 'caso:caso#1', content_hash: 'before', embedding_model: 'voyage-3.5', has_embedding: true },
      { id: 'old-2', locale: 'ES', source_key: 'caso:caso#2', content_hash: 'gone', embedding_model: 'voyage-3.5', has_embedding: true },
    ]);
    embeddings.embed.mockResolvedValue([vector]);

    const result = await indexer.syncSource('CASE', 'case-1');

    expect(embeddings.embed).toHaveBeenCalledWith(['texto changed'], 'document');
    expect(tx.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: { sourceType: 'CASE', sourceId: 'case-1', id: { notIn: ['old-0'] } },
    });
    expect(tx.knowledgeChunk.createManyAndReturn.mock.calls[0][0].data).toHaveLength(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ chunks: 2, embedded: 1, removed: 2 });
  });

  it('re-embeds everything when the stored model differs', async () => {
    vi.mocked(planSource).mockResolvedValue(planned([{ key: 'caso:caso#0', hash: 'same' }]));
    prisma.$queryRaw.mockResolvedValue([
      { id: 'old-0', locale: 'ES', source_key: 'caso:caso#0', content_hash: 'same', embedding_model: 'voyage-3.5-lite', has_embedding: true },
    ]);
    embeddings.embed.mockResolvedValue([vector]);

    const result = await indexer.syncSource('CASE', 'case-1');

    expect(result).toEqual({ chunks: 1, embedded: 1, removed: 1 });
  });

  it('removes every chunk of a source that is no longer eligible, without calling Voyage', async () => {
    vi.mocked(planSource).mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([
      { id: 'old-0', locale: 'ES', source_key: 'caso:caso#0', content_hash: 'x', embedding_model: 'voyage-3.5', has_embedding: true },
    ]);

    const result = await indexer.syncSource('CASE', 'case-1');

    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(tx.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: { sourceType: 'CASE', sourceId: 'case-1', id: { notIn: [] } },
    });
    expect(result).toEqual({ chunks: 0, embedded: 0, removed: 1 });
  });
});
