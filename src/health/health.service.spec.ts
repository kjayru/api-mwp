import { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  const queryRaw = vi.fn();
  const service = new HealthService({
    $queryRaw: queryRaw,
  } as unknown as PrismaService);

  beforeEach(() => {
    queryRaw.mockReset();
  });

  it('reports the database up with pgvector installed', async () => {
    queryRaw.mockResolvedValue([{ pgvector: true }]);

    await expect(service.checkDatabase()).resolves.toEqual({
      database: 'up',
      pgvector: true,
    });
  });

  it('reports the database down when the query fails', async () => {
    queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(service.checkDatabase()).resolves.toEqual({
      database: 'down',
      pgvector: false,
    });
  });
});
