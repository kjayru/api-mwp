import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  CaseType,
  KnowledgeSourceType,
  Locale,
} from '../../generated/prisma/enums.js';
import { slugify } from '../../common/slug.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  EMBEDDINGS_PROVIDER,
  type EmbeddingsProvider,
  toVectorLiteral,
} from './embeddings/embeddings-provider.js';

/** Added to the similarity of the chunks of the case the visitor is viewing. */
export const CASE_PAGE_BOOST = 0.1;
export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 10;

export interface KnowledgeHit {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  locale: Locale;
  sourceKey: string;
  title: string;
  url: string | null;
  content: string;
  /** Cosine similarity with the query, 0-1 (1 = same direction). */
  similarity: number;
  /** similarity + CASE_PAGE_BOOST for the case being viewed; used to rank and filter. */
  score: number;
}

export interface SearchOptions {
  /** Slug (in `locale`, or the other locale) of the case page being viewed. */
  caseSlug?: string | null;
  limit?: number;
  type?: CaseType;
  /** Technology name or slug (case-insensitive). */
  technology?: string;
  /** Overrides KNOWLEDGE_MIN_SIMILARITY (tests, tuning). */
  minSimilarity?: number;
}

export interface SearchOutcome {
  /** Chunks with score >= threshold, best first. Empty = nothing relevant. */
  hits: KnowledgeHit[];
  /** Best score seen, relevant or not (logged to tune the threshold). */
  bestScore: number | null;
  threshold: number;
  /** True when nothing passed in `locale` and the hits come from the other locale. */
  usedOtherLocale: boolean;
}

interface Row {
  source_type: KnowledgeSourceType;
  source_id: string;
  locale: Locale;
  source_key: string;
  title: string;
  url: string | null;
  content: string;
  similarity: number;
}

/**
 * Keeps the hits whose score passes the threshold, best first, at most
 * `limit` (pure; unit-tested).
 */
export function rankHits(
  rows: Row[],
  options: { threshold: number; limit: number; boostCaseId?: string | null },
): { hits: KnowledgeHit[]; bestScore: number | null } {
  const byKey = new Map<string, KnowledgeHit>();
  for (const row of rows) {
    const boosted =
      options.boostCaseId &&
      row.source_type === 'CASE' &&
      row.source_id === options.boostCaseId;
    const similarity = Number(row.similarity);
    const hit: KnowledgeHit = {
      sourceType: row.source_type,
      sourceId: row.source_id,
      locale: row.locale,
      sourceKey: row.source_key,
      title: row.title,
      url: row.url,
      content: row.content,
      similarity,
      score: similarity + (boosted ? CASE_PAGE_BOOST : 0),
    };
    byKey.set(`${hit.locale}|${hit.sourceKey}`, hit);
  }
  const all = [...byKey.values()].sort((a, b) => b.score - a.score);
  return {
    hits: all
      .filter((hit) => hit.score >= options.threshold)
      .slice(0, options.limit),
    bestScore: all.length > 0 ? all[0].score : null,
  };
}

/** Semantic search over knowledge_chunks (pgvector cosine distance). */
@Injectable()
export class KnowledgeSearchService {
  private readonly threshold: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDINGS_PROVIDER)
    private readonly embeddings: EmbeddingsProvider,
    config: ConfigService<Env, true>,
  ) {
    this.threshold = config.get('KNOWLEDGE_MIN_SIMILARITY', { infer: true });
  }

  get minSimilarity(): number {
    return this.threshold;
  }

  /**
   * Searches the chunks of `locale` first; when nothing there is relevant,
   * the other locale. With `caseSlug`, the chunks of that case are always
   * candidates and get CASE_PAGE_BOOST.
   */
  async search(
    query: string,
    locale: Locale,
    options: SearchOptions = {},
  ): Promise<SearchOutcome> {
    const threshold = options.minSimilarity ?? this.threshold;
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    );
    const [vector] = await this.embeddings.embed([query], 'query');
    const literal = toVectorLiteral(vector);
    const caseId = options.caseSlug
      ? await this.caseIdForSlug(options.caseSlug, locale)
      : null;

    const first = await this.searchLocale(literal, locale, limit, caseId, options);
    const ranked = rankHits(first, { threshold, limit, boostCaseId: caseId });
    if (ranked.hits.length > 0) {
      return { ...ranked, threshold, usedOtherLocale: false };
    }
    const other: Locale = locale === 'ES' ? 'EN' : 'ES';
    const second = await this.searchLocale(literal, other, limit, caseId, options);
    const fallback = rankHits(second, { threshold, limit, boostCaseId: caseId });
    const scores = [ranked.bestScore, fallback.bestScore].filter(
      (score): score is number => score !== null,
    );
    return {
      hits: fallback.hits,
      bestScore: scores.length > 0 ? Math.max(...scores) : null,
      threshold,
      usedOtherLocale: fallback.hits.length > 0,
    };
  }

  private async searchLocale(
    vector: string,
    locale: Locale,
    limit: number,
    caseId: string | null,
    options: SearchOptions,
  ): Promise<Row[]> {
    const filters: Prisma.Sql[] = [];
    if (options.type) {
      filters.push(Prisma.sql`AND case_type = ${options.type}::case_type`);
    }
    const technology = options.technology?.trim().toLowerCase();
    if (technology) {
      const slug = slugify(technology);
      filters.push(
        Prisma.sql`AND (${technology} = ANY(technologies) OR ${slug} = ANY(technologies))`,
      );
    }
    // Prisma.join() rejects an empty list.
    const where = filters.length > 0 ? Prisma.join(filters, ' ') : Prisma.empty;
    const select = Prisma.sql`
      SELECT source_type, source_id, locale, source_key, title, url, content,
             1 - (embedding <=> ${vector}::vector) AS similarity
      FROM knowledge_chunks
      WHERE embedding IS NOT NULL AND locale = ${locale}::locale`;

    const rows = await this.prisma.$queryRaw<Row[]>`
      ${select} ${where}
      ORDER BY embedding <=> ${vector}::vector
      LIMIT ${limit * 2}`;
    if (!caseId) return rows;
    const caseRows = await this.prisma.$queryRaw<Row[]>`
      ${select} ${where}
        AND source_type = 'CASE'::knowledge_source_type AND source_id = ${caseId}
      ORDER BY embedding <=> ${vector}::vector
      LIMIT 3`;
    return [...rows, ...caseRows];
  }

  /** Case id of a published slug; tries `locale` first, then any locale. */
  private async caseIdForSlug(
    slug: string,
    locale: Locale,
  ): Promise<string | null> {
    const rows = await this.prisma.caseTranslation.findMany({
      where: { slug, case: { deletedAt: null } },
      select: { caseId: true, locale: true },
    });
    return (
      rows.find((row) => row.locale === locale)?.caseId ??
      rows[0]?.caseId ??
      null
    );
  }
}
