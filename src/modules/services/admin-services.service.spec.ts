import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { RevalidationService } from '../../common/revalidation/revalidation.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  AdminServicesService,
  missingForServicePublish,
  SERVICE_NOT_FOUND,
} from './admin-services.service.js';

const NOW = new Date('2026-10-02T12:00:00Z');

function translation(
  locale: 'ES' | 'EN',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `st-${locale}`,
    serviceId: 'svc-1',
    locale,
    title: locale === 'ES' ? 'Webs con CMS' : 'Websites with a CMS',
    slug: locale === 'ES' ? 'webs-con-cms' : 'websites-with-cms',
    description: 'Descripción',
    status: 'DRAFT',
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function serviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    sortOrder: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    translations: [translation('ES'), translation('EN')],
    technologies: [{ technologyId: 'tech-1' }],
    ...overrides,
  };
}

describe('AdminServicesService', () => {
  const prisma = {
    service: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
    },
    serviceTranslation: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    serviceTechnology: { deleteMany: vi.fn(), createMany: vi.fn() },
    technology: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const revalidation = { revalidate: vi.fn() };
  let service: AdminServicesService;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    );
    prisma.service.findFirst.mockResolvedValue(serviceRow());
    prisma.serviceTranslation.findUnique.mockResolvedValue(null);
    prisma.serviceTranslation.count.mockResolvedValue(0);
    revalidation.revalidate.mockResolvedValue(undefined);
    service = new AdminServicesService(
      prisma as unknown as PrismaService,
      revalidation as unknown as RevalidationService,
    );
  });

  it('creates a draft with generated slugs and linked technologies', async () => {
    prisma.service.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
    prisma.service.create.mockResolvedValue({ id: 'svc-1' });
    prisma.technology.findMany.mockResolvedValue([{ id: 'tech-1' }]);

    const result = await service.create({
      technologyIds: ['tech-1'],
      translations: { ES: { title: 'Apps móviles' } },
    });

    expect(prisma.service.create).toHaveBeenCalledWith({
      data: {
        sortOrder: 1,
        translations: {
          create: [
            {
              locale: 'ES',
              title: 'Apps móviles',
              slug: 'apps-moviles',
              description: '',
            },
          ],
        },
        technologies: { create: [{ technologyId: 'tech-1', sortOrder: 1 }] },
      },
      select: { id: true },
    });
    expect(result.translations.ES).toMatchObject({ status: 'DRAFT' });
    expect(revalidation.revalidate).not.toHaveBeenCalled();
  });

  it('returns 409 for a slug used by another service', async () => {
    prisma.serviceTranslation.findUnique.mockResolvedValue({
      serviceId: 'svc-2',
      service: { deletedAt: null },
    });
    await expect(
      service.update('svc-1', { translations: { ES: { slug: 'ocupado' } } }),
    ).rejects.toThrow(ConflictException);
  });

  it('publish requires title, slug and description (422 in Spanish)', async () => {
    prisma.service.findFirst.mockResolvedValue(
      serviceRow({ translations: [translation('EN', { description: '' })] }),
    );

    const error = await service.publish('svc-1', 'EN').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
      {
        message: 'No se puede publicar la versión EN. Falta: descripción',
        details: { locale: 'EN', missing: ['description'] },
      },
    );
  });

  it('publishes, keeping publishedAt when already set, and revalidates services', async () => {
    await service.publish('svc-1', 'ES');

    expect(prisma.serviceTranslation.update).toHaveBeenCalledWith({
      where: { id: 'st-ES' },
      data: { status: 'PUBLISHED', publishedAt: expect.any(Date) },
    });
    expect(revalidation.revalidate).toHaveBeenCalledWith(['services']);
  });

  it('does not let a published translation become incomplete', async () => {
    prisma.service.findFirst.mockResolvedValue(
      serviceRow({
        translations: [translation('ES', { status: 'PUBLISHED' })],
      }),
    );
    await expect(
      service.update('svc-1', { translations: { ES: { description: '' } } }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('requires a title to create a missing locale', async () => {
    prisma.service.findFirst.mockResolvedValue(
      serviceRow({ translations: [translation('ES')] }),
    );
    await expect(
      service.update('svc-1', { translations: { EN: { description: 'x' } } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('soft-deletes, with 404 for unknown ids', async () => {
    prisma.service.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.remove('svc-1');
    expect(prisma.service.updateMany).toHaveBeenCalledWith({
      where: { id: 'svc-1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });

    prisma.service.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove('nope')).rejects.toThrow(
      new NotFoundException(SERVICE_NOT_FOUND),
    );
  });

  it('reorder requires exactly the non-deleted ids', async () => {
    prisma.service.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(service.reorder(['a'])).rejects.toThrow(BadRequestException);
    await service.reorder(['b', 'a']);
    expect(prisma.service.updateMany).toHaveBeenCalledWith({
      where: { id: 'b', NOT: { sortOrder: 1 } },
      data: { sortOrder: 1 },
    });
  });
});

describe('missingForServicePublish', () => {
  it('lists the blank required fields', () => {
    expect(
      missingForServicePublish({ title: 'T', slug: 's', description: 'D' }),
    ).toEqual([]);
    expect(missingForServicePublish(null)).toEqual([
      'title',
      'slug',
      'description',
    ]);
  });
});
