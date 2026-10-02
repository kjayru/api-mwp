import type { PrismaService } from '../../prisma/prisma.service.js';
import { computeStats, StatsService } from './stats.service.js';

describe('computeStats', () => {
  it('counts projects, distinct technologies and distinct non-empty ES industries', () => {
    expect(
      computeStats([
        {
          translations: [{ industry: 'Carpintería' }],
          technologies: [{ technologyId: 't1' }, { technologyId: 't2' }],
        },
        {
          translations: [{ industry: ' carpintería ' }],
          technologies: [{ technologyId: 't2' }],
        },
        {
          translations: [{ industry: '' }],
          technologies: [{ technologyId: 't3' }],
        },
        // Published only in EN: no ES translation row.
        { translations: [], technologies: [] },
        { translations: [{ industry: null }], technologies: [] },
      ]),
    ).toEqual({ projects: 5, technologies: 3, industries: 1 });
  });

  it('returns zeros without published cases', () => {
    expect(computeStats([])).toEqual({
      projects: 0,
      technologies: 0,
      industries: 0,
    });
  });
});

describe('StatsService', () => {
  it('only considers non-deleted cases published in some locale', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new StatsService({
      case: { findMany },
    } as unknown as PrismaService);

    await service.get();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          translations: { some: { status: 'PUBLISHED' } },
        },
      }),
    );
    const { select } = findMany.mock.calls[0][0];
    expect(select.translations.where).toEqual({ locale: 'ES' });
    expect(select.technologies.where).toEqual({
      technology: { deletedAt: null },
    });
  });
});
