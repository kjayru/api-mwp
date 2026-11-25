import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import type { KnowledgeSourceType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KnowledgeIndexerService } from './knowledge-indexer.service.js';

export const REINDEX_ALREADY_RUNNING =
  'Ya hay una reindexación en curso. Espera a que termine.';

/**
 * Schedules knowledge base updates without blocking the admin requests that
 * trigger them (fire-and-forget, like the front revalidation). Every job runs
 * on one in-process queue, in order, so two quick edits of the same case can
 * never interleave; a job that is already waiting is not queued twice.
 */
@Injectable()
export class KnowledgeSyncService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeSyncService.name);
  private queue: Promise<void> = Promise.resolve();
  private readonly waiting = new Set<string>();
  private fullRunQueued = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: KnowledgeIndexerService,
  ) {}

  /** A run left RUNNING by a crash or restart would block reindexing forever. */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.indexingRun.updateMany({
        where: { status: 'RUNNING' },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: 'Interrumpida: la API se reinició durante la indexación',
        },
      });
    } catch (error) {
      // The database may be down at boot; the health endpoint reports it.
      this.logger.warn(
        `Could not close stale indexing runs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Re-chunks a case after publish, unpublish, edit or delete. Never throws. */
  scheduleCase(caseId: string): void {
    this.scheduleSource('CASE', caseId);
  }

  /** Same for a FAQ. Never throws. */
  scheduleFaq(faqId: string): void {
    this.scheduleSource('FAQ', faqId);
  }

  /**
   * Starts a full reindex in the background ("Reindexar ahora"). 409 when one
   * is already running or queued.
   */
  async startFullReindex(): Promise<{ id: string; startedAt: Date }> {
    if (this.fullRunQueued) {
      throw new ConflictException(REINDEX_ALREADY_RUNNING);
    }
    const running = await this.prisma.indexingRun.count({
      where: { status: 'RUNNING' },
    });
    if (running > 0) {
      throw new ConflictException(REINDEX_ALREADY_RUNNING);
    }
    this.fullRunQueued = true;
    try {
      const run = await this.prisma.indexingRun.create({
        data: { status: 'RUNNING' },
        select: { id: true, startedAt: true },
      });
      this.enqueue(`full:${run.id}`, async () => {
        try {
          await this.indexer.runFullReindex(run.id);
        } finally {
          this.fullRunQueued = false;
        }
      });
      return run;
    } catch (error) {
      this.fullRunQueued = false;
      throw error;
    }
  }

  /** Resolves when every queued job has finished (tests and the seed use it). */
  async idle(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.queue;
      await current;
    } while (current !== this.queue);
  }

  private scheduleSource(type: KnowledgeSourceType, id: string): void {
    this.enqueue(`${type}:${id}`, async () => {
      const result = await this.indexer.syncSource(type, id);
      this.logger.log(
        `Knowledge ${type} ${id}: ${result.chunks} chunks (${result.embedded} embedded, ${result.removed} removed)`,
      );
    });
  }

  private enqueue(key: string, job: () => Promise<void>): void {
    if (this.waiting.has(key)) return;
    this.waiting.add(key);
    this.queue = this.queue.then(async () => {
      this.waiting.delete(key);
      try {
        await job();
      } catch (error) {
        this.logger.warn(
          `Knowledge job ${key} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }
}
