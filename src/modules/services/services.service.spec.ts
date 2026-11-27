import type { PrismaService } from '../../prisma/prisma.service.js';
import { ServicesService } from './services.service.js';

describe('ServicesService', () => {
  const findMany = vi.fn();
  const prisma = { serviceTranslation: { findMany } };
  let service: ServicesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ServicesService(prisma as unknown as PrismaService);
  });

  it('queries published translations of non-deleted services in the DB locale', async () => {
    findMany.mockResolvedValue([]);

    await service.list('en');

    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      locale: 'EN',
      status: 'PUBLISHED',
      service: { deletedAt: null },
    });
    expect(args.select.service.select.technologies.where).toEqual({
      technology: { deletedAt: null },
    });
  });

  it('maps ES requests to the ES locale', async () => {
    findMany.mockResolvedValue([]);
    await service.list('es');
    expect(findMany.mock.calls[0][0].where.locale).toBe('ES');
  });

  it('flattens the technologies and drops the service wrapper', async () => {
    findMany.mockResolvedValue([
      {
        title: 'Web',
        slug: 'web',
        description: 'desc',
        service: {
          technologies: [
            { technology: { name: 'React', slug: 'react' } },
            { technology: { name: 'Nest', slug: 'nest' } },
          ],
        },
      },
      {
        title: 'Apps',
        slug: 'apps',
        description: 'd2',
        service: { technologies: [] },
      },
    ]);

    const out = await service.list('es');

    expect(out).toEqual([
      {
        title: 'Web',
        slug: 'web',
        description: 'desc',
        technologies: [
          { name: 'React', slug: 'react' },
          { name: 'Nest', slug: 'nest' },
        ],
      },
      { title: 'Apps', slug: 'apps', description: 'd2', technologies: [] },
    ]);
    expect(out[0]).not.toHaveProperty('service');
  });
});
