import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  KnowledgeSourceType,
  Locale,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  EMBEDDINGS_PROVIDER,
  type EmbeddingsProvider,
  toVectorLiteral,
} from './embeddings/embeddings-provider.js';
import type { ChunkDraft } from './chunking.js';
import {
  planAll,
  planSource,
  type PlannedSource,
} from './knowledge-sources.js';

/** One stored chunk, without its vector. */
export interface IndexedChunkRow {
  id: string;
  source_type: KnowledgeSourceType;
  source_id: string;
  locale: Locale;
  source_key: string;
  content_hash: string;
  embedding_model: string;
  has_embedding: boolean;
  title: string;
  updated_at: Date;
}

export interface SyncResult {
  /** Chunks the source has after the sync. */
  chunks: number;
  /** Chunks whose embedding was computed (new or changed content). */
  embedded: number;
  /** Chunks deleted (changed, or no longer eligible). */
  removed: number;
}

export type PendingReason = 'new' | 'changed' | 'removed';

export interface PendingSource {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  locale: Locale;
  title: string;
  reason: PendingReason;
}

/** What has to change for one source (case or FAQ, every locale). */
interface SourceDiff {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  existing: number;
  /** Stored chunk ids that stay as they are. */
  keep: string[];
  /** Chunks to (re)create, with a new embedding. */
  toEmbed: { locale: Locale; chunk: ChunkDraft }[];
}

/** Key of a stored or planned chunk: same key = same text, same model. */
function chunkKey(locale: Locale, sourceKey: string, hash: string): string {
  return `${locale}|${sourceKey}|${hash}`;
}

function sourceKeyOf(type: KnowledgeSourceType, id: string): string {
  return `${type}|${id}`;
}

/**
 * Writes the knowledge base: chunks + Voyage embeddings in knowledge_chunks.
 * Incremental: a chunk whose text did not change keeps its embedding, so a
 * reindex only pays for what changed, and a full reindex embeds all the
 * changes in as few Voyage requests as possible.
 */
@Injectable()
export class KnowledgeIndexerService {
  private readonly logger = new Logger(KnowledgeIndexerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDINGS_PROVIDER)
    private readonly embeddings: EmbeddingsProvider,
  ) {}

  /** Re-chunks one case or FAQ (every locale) and stores what changed. */
  async syncSource(
    sourceType: KnowledgeSourceType,
    sourceId: string,
  ): Promise<SyncResult> {
    const planned = await planSource(this.prisma, sourceType, sourceId);
    const diff = await this.diff(sourceType, sourceId, planned);
    const vectors = await this.embed(diff.toEmbed);
    await this.write(diff, vectors);
    return this.result(diff);
  }

  /**
   * Full reindex: every eligible source, plus removal of chunks whose source
   * is no longer eligible. Records the outcome on the IndexingRun.
   */
  async runFullReindex(runId: string): Promise<void> {
    try {
      const planned = await planAll(this.prisma);
      const groups = new Map<string, PlannedSource[]>();
      for (const source of planned) {
        const key = sourceKeyOf(source.sourceType, source.sourceId);
        groups.set(key, [...(groups.get(key) ?? []), source]);
      }

      const diffs: SourceDiff[] = [];
      for (const sources of groups.values()) {
        const { sourceType, sourceId } = sources[0];
        diffs.push(await this.diff(sourceType, sourceId, sources));
      }
      // One embedding call for every changed chunk (batched by the provider).
      const vectors = await this.embed(diffs.flatMap((d) => d.toEmbed));

      let chunks = 0;
      let embedded = 0;
      let removed = 0;
      let offset = 0;
      for (const diff of diffs) {
        await this.write(
          diff,
          vectors.slice(offset, offset + diff.toEmbed.length),
        );
        offset += diff.toEmbed.length;
        const result = this.result(diff);
        chunks += result.chunks;
        embedded += result.embedded;
        removed += result.removed;
      }

      const stored = await this.prisma.$queryRaw<
        { source_type: KnowledgeSourceType; source_id: string }[]
      >`SELECT DISTINCT source_type, source_id FROM knowledge_chunks`;
      for (const row of stored) {
        if (groups.has(sourceKeyOf(row.source_type, row.source_id))) continue;
        const { count } = await this.prisma.knowledgeChunk.deleteMany({
          where: { sourceType: row.source_type, sourceId: row.source_id },
        });
        removed += count;
      }

      await this.prisma.indexingRun.update({
        where: { id: runId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          sourcesCount: planned.length,
          chunksCount: chunks,
          embeddedCount: embedded,
          removedCount: removed,
        },
      });
      this.logger.log(
        `Full reindex ${runId}: ${planned.length} sources, ${chunks} chunks (${embedded} embedded, ${removed} removed)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Full reindex ${runId} failed: ${message}`);
      await this.prisma.indexingRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: message.slice(0, 1000),
        },
      });
    }
  }

  /** Stored chunks of one source (or of every source), without vectors. */
  async indexedChunks(
    sourceType?: KnowledgeSourceType,
    sourceId?: string,
  ): Promise<IndexedChunkRow[]> {
    const where =
      sourceType && sourceId
        ? Prisma.sql`WHERE source_type = ${sourceType}::knowledge_source_type AND source_id = ${sourceId}`
        : Prisma.empty;
    return this.prisma.$queryRaw<IndexedChunkRow[]>`
      SELECT id, source_type, source_id, locale, source_key, content_hash,
             embedding_model, embedding IS NOT NULL AS has_embedding, title, updated_at
      FROM knowledge_chunks ${where}
      ORDER BY source_type, source_id, locale, chunk_index`;
  }

  /**
   * Sources whose stored chunks differ from what they should be now: new,
   * changed (text, model or a missing embedding) or no longer eligible.
   */
  async pendingSources(): Promise<{
    pending: PendingSource[];
    stored: IndexedChunkRow[];
  }> {
    const [planned, stored] = await Promise.all([
      planAll(this.prisma),
      this.indexedChunks(),
    ]);
    const model = this.embeddings.model;
    const storedBySource = new Map<string, IndexedChunkRow[]>();
    for (const row of stored) {
      const key = `${sourceKeyOf(row.source_type, row.source_id)}|${row.locale}`;
      storedBySource.set(key, [...(storedBySource.get(key) ?? []), row]);
    }

    const pending: PendingSource[] = [];
    const plannedKeys = new Set<string>();
    for (const source of planned) {
      const key = `${sourceKeyOf(source.sourceType, source.sourceId)}|${source.locale}`;
      plannedKeys.add(key);
      const rows = storedBySource.get(key) ?? [];
      const valid = new Set(
        rows
          .filter((row) => row.has_embedding && row.embedding_model === model)
          .map((row) => chunkKey(row.locale, row.source_key, row.content_hash)),
      );
      const expected = source.chunks.map((chunk) =>
        chunkKey(source.locale, chunk.sourceKey, chunk.contentHash),
      );
      const upToDate =
        rows.length === expected.length && expected.every((k) => valid.has(k));
      if (!upToDate) {
        pending.push({
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          locale: source.locale,
          title: source.title,
          reason: rows.length === 0 ? 'new' : 'changed',
        });
      }
    }
    for (const [key, rows] of storedBySource) {
      if (plannedKeys.has(key)) continue;
      pending.push({
        sourceType: rows[0].source_type,
        sourceId: rows[0].source_id,
        locale: rows[0].locale,
        title: rows[0].title,
        reason: 'removed',
      });
    }
    return { pending, stored };
  }

  private async diff(
    sourceType: KnowledgeSourceType,
    sourceId: string,
    planned: PlannedSource[],
  ): Promise<SourceDiff> {
    const existing = await this.indexedChunks(sourceType, sourceId);
    const model = this.embeddings.model;
    const reusable = new Map(
      existing
        .filter((row) => row.has_embedding && row.embedding_model === model)
        .map((row) => [
          chunkKey(row.locale, row.source_key, row.content_hash),
          row,
        ]),
    );
    const keep: string[] = [];
    const toEmbed: SourceDiff['toEmbed'] = [];
    for (const source of planned) {
      for (const chunk of source.chunks) {
        const row = reusable.get(
          chunkKey(source.locale, chunk.sourceKey, chunk.contentHash),
        );
        if (row) keep.push(row.id);
        else toEmbed.push({ locale: source.locale, chunk });
      }
    }
    return { sourceType, sourceId, existing: existing.length, keep, toEmbed };
  }

  /** Embeds before any transaction opens: the Voyage call may take seconds. */
  private embed(items: SourceDiff['toEmbed']): Promise<number[][]> {
    if (items.length === 0) return Promise.resolve([]);
    return this.embeddings.embed(
      items.map((item) => item.chunk.content),
      'document',
    );
  }

  /** Makes the stored chunks of one source match the diff (atomically). */
  private async write(diff: SourceDiff, vectors: number[][]): Promise<void> {
    const { sourceType, sourceId, keep, toEmbed } = diff;
    const model = this.embeddings.model;
    await this.prisma.$transaction(
      async (tx) => {
        await tx.knowledgeChunk.deleteMany({
          where: { sourceType, sourceId, id: { notIn: keep } },
        });
        if (keep.length > 0) {
          await tx.knowledgeChunk.updateMany({
            where: { id: { in: keep } },
            data: { updatedAt: new Date() },
          });
        }
        if (toEmbed.length === 0) return;
        const created = await tx.knowledgeChunk.createManyAndReturn({
          data: toEmbed.map(({ locale, chunk }) => ({
            sourceType,
            sourceId,
            locale,
            chunkIndex: chunk.chunkIndex,
            sourceKey: chunk.sourceKey,
            title: chunk.title,
            url: chunk.url,
            content: chunk.content,
            contentHash: chunk.contentHash,
            tokenCount: chunk.tokenCount,
            caseType: chunk.caseType,
            technologies: chunk.technologies,
            embeddingModel: model,
          })),
          select: { id: true, locale: true, sourceKey: true },
        });
        const ids = new Map(
          created.map((row) => [`${row.locale}|${row.sourceKey}`, row.id]),
        );
        for (const [index, { locale, chunk }] of toEmbed.entries()) {
          const id = ids.get(`${locale}|${chunk.sourceKey}`);
          const vector = toVectorLiteral(vectors[index]);
          await tx.$executeRaw`UPDATE knowledge_chunks SET embedding = ${vector}::vector WHERE id = ${id}`;
        }
      },
      { timeout: 30_000 },
    );
  }

  private result(diff: SourceDiff): SyncResult {
    return {
      chunks: diff.keep.length + diff.toEmbed.length,
      embedded: diff.toEmbed.length,
      removed: diff.existing - diff.keep.length,
    };
  }
}
