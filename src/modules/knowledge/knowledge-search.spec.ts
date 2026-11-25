import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { EMBEDDING_DIMENSION } from './embeddings/embeddings-provider.js';
import {
  CASE_PAGE_BOOST,
  KnowledgeSearchService,
  rankHits,
} from './knowledge-search.service.js';

function row(
  sourceKey: string,
  similarity: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    source_type: 'CASE' as const,
    source_id: `id-${sourceKey}`,
    locale: 'ES' as const,
    source_key: sourceKey,
    title: sourceKey,
    url: `/es/casos/${sourceKey}`,
    content: `contenido ${sourceKey}`,
    similarity,
    ...overrides,
  };
}

describe('rankHits', () => {
  it('keeps hits at or above the threshold, best first, up to the limit', () => {
    const { hits, bestScore } = rankHits(
      [row('a', 0.41), row('b', 0.62), row('c', 0.45), row('d', 0.7)],
      { threshold: 0.45, limit: 2 },
    );
    expect(hits.map((h) => h.sourceKey)).toEqual(['d', 'b']);
    expect(bestScore).toBe(0.7);
  });

  it('returns nothing (but reports the best score) when no chunk is relevant', () => {
    const { hits, bestScore } = rankHits([row('a', 0.3)], {
      threshold: 0.45,
      limit: 5,
    });
    expect(hits).toEqual([]);
    expect(bestScore).toBe(0.3);
  });

  it('boosts the chunks of the case being viewed and de-duplicates rows', () => {
    const boosted = row('caso', 0.4, { source_id: 'case-1' });
    const { hits } = rankHits([row('otro', 0.48), boosted, boosted], {
      threshold: 0.45,
      limit: 5,
      boostCaseId: 'case-1',
    });
    expect(hits.map((h) => h.sourceKey)).toEqual(['caso', 'otro']);
    expect(hits[0].score).toBeCloseTo(0.4 + CASE_PAGE_BOOST);
    expect(hits[0].similarity).toBe(0.4);
  });
});

describe('KnowledgeSearchService', () => {
  const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0.01);
  const embeddings = {
    model: 'voyage-3.5',
    configured: true,
    embed: vi.fn(),
  };
  const prisma = {
    $queryRaw: vi.fn(),
    caseTranslation: { findMany: vi.fn() },
  };
  const config = { get: vi.fn().mockReturnValue(0.45) };
  let service: KnowledgeSearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    embeddings.embed.mockResolvedValue([vector]);
    service = new KnowledgeSearchService(
      prisma as unknown as PrismaService,
      embeddings,
      config as unknown as ConfigService<never, true>,
    );
  });

  it('embeds the question as a query and searches the locale first', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([row('a', 0.6)]);

    const outcome = await service.search('¿contadores?', 'ES');

    expect(embeddings.embed).toHaveBeenCalledWith(['¿contadores?'], 'query');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(outcome.hits.map((h) => h.sourceKey)).toEqual(['a']);
    expect(outcome.usedOtherLocale).toBe(false);
    expect(outcome.threshold).toBe(0.45);
  });

  it('falls back to the other locale when nothing in the locale is relevant', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([row('es', 0.2)])
      .mockResolvedValueOnce([row('en', 0.5, { locale: 'EN' })]);

    const outcome = await service.search('payments', 'ES');

    expect(outcome.hits.map((h) => h.sourceKey)).toEqual(['en']);
    expect(outcome.usedOtherLocale).toBe(true);
    expect(outcome.bestScore).toBe(0.5);
  });

  it('reports no hits when neither locale has anything relevant', async () => {
    prisma.$queryRaw.mockResolvedValue([row('x', 0.1)]);
    const outcome = await service.search('relojes inteligentes', 'ES');
    expect(outcome.hits).toEqual([]);
    expect(outcome.usedOtherLocale).toBe(false);
  });

  it('with caseSlug, also queries the chunks of that case', async () => {
    prisma.caseTranslation.findMany.mockResolvedValue([
      { caseId: 'case-1', locale: 'ES' },
    ]);
    prisma.$queryRaw
      .mockResolvedValueOnce([row('otro', 0.5)])
      .mockResolvedValueOnce([row('mio', 0.42, { source_id: 'case-1' })]);

    const outcome = await service.search('¿cuánto tardó?', 'ES', {
      caseSlug: 'contaflow-ia',
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(outcome.hits.map((h) => h.sourceKey)).toEqual(['mio', 'otro']);
  });
});
