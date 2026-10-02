import { ConflictException, NotFoundException } from '@nestjs/common';
import type { RevalidationService } from '../../common/revalidation/revalidation.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  AdminTechnologiesService,
  TECHNOLOGY_NOT_FOUND,
} from './admin-technologies.service.js';
import { TechnologiesService } from './technologies.service.js';

const row = {
  id: 'tech-1',
  name: 'Next.js',
  slug: 'nextjs',
  category: 'FRONTEND',
  isFeatured: true,
  sortOrder: 3,
  translations: [{ locale: 'ES', description: 'Framework de React' }],
  _count: { cases: 2, services: 1 },
};

describe('AdminTechnologiesService', () => {
  const prisma = {
    technology: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
    },
    technologyTranslation: { upsert: vi.fn() },
    $transaction: vi.fn(),
  };
  const revalidation = { revalidate: vi.fn() };
  let service: AdminTechnologiesService;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    revalidation.revalidate.mockResolvedValue(undefined);
    service = new AdminTechnologiesService(
      prisma as unknown as PrismaService,
      revalidation as unknown as RevalidationService,
    );
  });

  it('maps descriptions per locale and usage counts', async () => {
    prisma.technology.findFirst.mockResolvedValue(row);

    await expect(service.findOne('tech-1')).resolves.toEqual({
      id: 'tech-1',
      name: 'Next.js',
      slug: 'nextjs',
      category: 'FRONTEND',
      isFeatured: true,
      sortOrder: 3,
      descriptions: { ES: 'Framework de React', EN: null },
      usage: { cases: 2, services: 1 },
    });
  });

  it('creates with a generated slug at the end of the list', async () => {
    prisma.technology.findFirst
      .mockResolvedValueOnce(null) // name check
      .mockResolvedValueOnce(row); // findOne
    prisma.technology.count.mockImplementation(
      ({ where }: { where: { slug: string } }) =>
        Promise.resolve(where.slug === 'net-core' ? 1 : 0),
    );
    prisma.technology.aggregate.mockResolvedValue({ _max: { sortOrder: 10 } });
    prisma.technology.create.mockResolvedValue({ id: 'tech-1' });

    await service.create({
      name: '.NET Core',
      descriptions: { ES: 'Backend', EN: null },
    });

    expect(prisma.technology.create).toHaveBeenCalledWith({
      data: {
        name: '.NET Core',
        slug: 'net-core-2',
        category: undefined,
        isFeatured: undefined,
        sortOrder: 11,
      },
      select: { id: true },
    });
    expect(prisma.technologyTranslation.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.technologyTranslation.upsert).toHaveBeenCalledWith({
      where: { technologyId_locale: { technologyId: 'tech-1', locale: 'EN' } },
      create: { technologyId: 'tech-1', locale: 'EN', description: null },
      update: { description: null },
    });
    expect(revalidation.revalidate).toHaveBeenCalledWith(['technologies']);
  });

  it('returns 409 for a duplicate name regardless of case', async () => {
    prisma.technology.findFirst.mockResolvedValue({
      name: 'Next.js',
      deletedAt: null,
    });

    await expect(service.create({ name: 'next.js' })).rejects.toThrow(
      new ConflictException('Ya existe una tecnología llamada "Next.js"'),
    );
    expect(prisma.technology.findFirst.mock.calls[0][0].where).toEqual({
      name: { equals: 'next.js', mode: 'insensitive' },
    });
  });

  it('returns 409 for a slug taken by another technology', async () => {
    prisma.technology.findFirst.mockResolvedValueOnce({
      name: 'Next.js',
      slug: 'nextjs',
    });
    prisma.technology.findUnique.mockResolvedValue({ deletedAt: null });

    await expect(service.update('tech-1', { slug: 'react' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('soft-deletes even when in use and revalidates everything that shows chips', async () => {
    prisma.technology.updateMany.mockResolvedValue({ count: 1 });

    await service.remove('tech-1');

    expect(prisma.technology.updateMany).toHaveBeenCalledWith({
      where: { id: 'tech-1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(revalidation.revalidate).toHaveBeenCalledWith([
      'technologies',
      'cases',
      'services',
      'stats',
    ]);
  });

  it('returns 404 for unknown ids', async () => {
    prisma.technology.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('nope')).rejects.toThrow(
      new NotFoundException(TECHNOLOGY_NOT_FOUND),
    );
  });
});

describe('TechnologiesService', () => {
  it('lists non-deleted technologies with the description of the locale', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        name: 'Next.js',
        slug: 'nextjs',
        category: 'FRONTEND',
        isFeatured: true,
        translations: [{ description: 'React framework' }],
      },
      {
        name: 'Prisma',
        slug: 'prisma',
        category: 'BACKEND',
        isFeatured: false,
        translations: [],
      },
    ]);
    const service = new TechnologiesService({
      technology: { findMany },
    } as unknown as PrismaService);

    await expect(service.list('en', true)).resolves.toEqual([
      {
        name: 'Next.js',
        slug: 'nextjs',
        category: 'FRONTEND',
        isFeatured: true,
        description: 'React framework',
      },
      {
        name: 'Prisma',
        slug: 'prisma',
        category: 'BACKEND',
        isFeatured: false,
        description: null,
      },
    ]);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ deletedAt: null, isFeatured: true });
    expect(args.select.translations.where).toEqual({ locale: 'EN' });
  });
});
