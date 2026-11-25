import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { KnowledgeIndexerService } from './knowledge-indexer.service.js';
import { KnowledgeSyncService } from './knowledge-sync.service.js';

describe('KnowledgeSyncService', () => {
  const prisma = {
    indexingRun: {
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const indexer = {
    syncSource: vi.fn(),
    runFullReindex: vi.fn(),
  };
  let sync: KnowledgeSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    indexer.syncSource.mockResolvedValue({ chunks: 1, embedded: 1, removed: 0 });
    indexer.runFullReindex.mockResolvedValue(undefined);
    prisma.indexingRun.count.mockResolvedValue(0);
    prisma.indexingRun.create.mockResolvedValue({ id: 'run-1', startedAt: new Date() });
    sync = new KnowledgeSyncService(
      prisma as unknown as PrismaService,
      indexer as unknown as KnowledgeIndexerService,
    );
  });

  it('runs scheduled syncs in order and never queues a waiting job twice', async () => {
    sync.scheduleCase('a');
    sync.scheduleCase('a');
    sync.scheduleFaq('f');
    await sync.idle();
    expect(indexer.syncSource.mock.calls).toEqual([
      ['CASE', 'a'],
      ['FAQ', 'f'],
    ]);
  });

  it('logs failures instead of throwing (fire-and-forget)', async () => {
    indexer.syncSource.mockRejectedValueOnce(new Error('Voyage down'));
    sync.scheduleCase('a');
    sync.scheduleCase('b');
    await sync.idle();
    expect(indexer.syncSource).toHaveBeenCalledTimes(2);
  });

  it('starts one full reindex at a time (409 otherwise)', async () => {
    const run = await sync.startFullReindex();
    expect(run.id).toBe('run-1');
    await expect(sync.startFullReindex()).rejects.toBeInstanceOf(ConflictException);
    await sync.idle();
    expect(indexer.runFullReindex).toHaveBeenCalledWith('run-1');

    // A RUNNING row (another process, or still running) also blocks it.
    prisma.indexingRun.count.mockResolvedValueOnce(1);
    await expect(sync.startFullReindex()).rejects.toBeInstanceOf(ConflictException);
  });

  it('closes runs left RUNNING by a restart', async () => {
    await sync.onModuleInit();
    expect(prisma.indexingRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'RUNNING' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });
});
