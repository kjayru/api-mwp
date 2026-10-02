import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { RevalidationService } from '../../common/revalidation/revalidation.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  AdminCasesService,
  IMAGE_NOT_FOUND,
  mergeAlt,
  missingForCasePublish,
} from './admin-cases.service.js';
import { CASE_NOT_FOUND } from './cases.service.js';

const NOW = new Date('2026-10-02T12:00:00Z');
const PUBLISHED_AT = new Date('2026-09-01T00:00:00Z');

function translation(
  locale: 'ES' | 'EN',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `tr-${locale}`,
    caseId: 'case-1',
    locale,
    title: locale === 'ES' ? 'CorteMaestro' : 'CorteMaestro EN',
    slug: locale === 'ES' ? 'cortemaestro' : 'cortemaestro-en',
    tagline: null,
    summary: 'Resumen',
    industry: 'Carpintería',
    blocks: [
      { type: 'text', title: 'El reto', body: 'Texto' },
      { type: 'gallery', imageIds: ['img-1', 'img-2'] },
    ],
    seoTitle: null,
    seoDescription: null,
    status: 'DRAFT',
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function caseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    type: 'TOOL',
    client: 'Cliente',
    anonymizeClient: false,
    year: 2026,
    coverImageUrl: null,
    includeInKnowledgeBase: true,
    sortOrder: 2,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    translations: [translation('ES'), translation('EN')],
    images: [
      {
        id: 'img-1',
        url: 'https://cdn/1.png',
        alt: { ES: 'Uno' },
        sortOrder: 1,
      },
      { id: 'img-2', url: 'https://cdn/2.png', alt: {}, sortOrder: 2 },
    ],
    technologies: [{ technologyId: 'tech-1' }],
    ...overrides,
  };
}

/** Status of the exception thrown by `promise` plus its response body. */
async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as Error & { getResponse(): unknown; getStatus(): number };
  }
  throw new Error('expected a rejection');
}

describe('AdminCasesService', () => {
  const prisma = {
    case: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
    },
    caseTranslation: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    caseImage: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    caseTechnology: { deleteMany: vi.fn(), createMany: vi.fn() },
    technology: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const revalidation = { revalidate: vi.fn() };
  let service: AdminCasesService;

  /** Tags sent in the last revalidation call. */
  const lastTags = () => revalidation.revalidate.mock.lastCall?.[0] as string[];

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    );
    prisma.case.findFirst.mockResolvedValue(caseRow());
    prisma.case.update.mockResolvedValue({ id: 'case-1' });
    prisma.caseTranslation.findUnique.mockResolvedValue(null);
    prisma.caseTranslation.count.mockResolvedValue(0);
    revalidation.revalidate.mockResolvedValue(undefined);
    service = new AdminCasesService(
      prisma as unknown as PrismaService,
      revalidation as unknown as RevalidationService,
    );
  });

  describe('findOne', () => {
    it('returns the editable shape with per-locale translations and alt texts', async () => {
      prisma.case.findFirst.mockResolvedValue(
        caseRow({ translations: [translation('ES')] }),
      );

      const result = await service.findOne('case-1');

      expect(result).toMatchObject({
        id: 'case-1',
        technologyIds: ['tech-1'],
        images: [
          { id: 'img-1', alt: { ES: 'Uno', EN: null }, sortOrder: 1 },
          { id: 'img-2', alt: { ES: null, EN: null }, sortOrder: 2 },
        ],
        translations: {
          ES: { slug: 'cortemaestro', status: 'DRAFT' },
          EN: null,
        },
      });
      expect(prisma.case.findFirst.mock.calls[0][0].where).toEqual({
        id: 'case-1',
        deletedAt: null,
      });
    });

    it('returns 404 for unknown or deleted cases', async () => {
      prisma.case.findFirst.mockResolvedValue(null);
      await expect(service.findOne('nope')).rejects.toThrow(
        new NotFoundException(CASE_NOT_FOUND),
      );
    });
  });

  describe('create', () => {
    beforeEach(() => {
      prisma.case.aggregate.mockResolvedValue({ _max: { sortOrder: 5 } });
      prisma.case.create.mockResolvedValue({ id: 'case-1' });
    });

    it('generates the slug from the title, appends the case at the end and does not revalidate', async () => {
      prisma.caseTranslation.count.mockImplementation(
        ({ where }: { where: { slug: string } }) =>
          Promise.resolve(where.slug === 'diseno-de-muebles' ? 1 : 0),
      );

      await service.create({
        type: 'TOOL',
        translations: { ES: { title: 'Diseño de muebles' } },
      });

      expect(prisma.case.create).toHaveBeenCalledWith({
        data: {
          type: 'TOOL',
          sortOrder: 6,
          translations: {
            create: [
              {
                locale: 'ES',
                title: 'Diseño de muebles',
                slug: 'diseno-de-muebles-2',
                summary: '',
              },
            ],
          },
        },
        select: { id: true },
      });
      expect(revalidation.revalidate).not.toHaveBeenCalled();
    });

    it('keeps an explicit free slug', async () => {
      await service.create({
        type: 'SAAS',
        translations: { EN: { title: 'Anything', slug: 'my-case' } },
      });
      expect(
        prisma.case.create.mock.calls[0][0].data.translations.create[0].slug,
      ).toBe('my-case');
    });

    it('returns 409 when an explicit slug is taken', async () => {
      prisma.caseTranslation.findUnique.mockResolvedValue({
        caseId: 'other',
        case: { deletedAt: null },
      });

      const error = await rejection(
        service.create({
          type: 'SAAS',
          translations: { ES: { title: 'X', slug: 'cortemaestro' } },
        }),
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        'El slug "cortemaestro" ya está en uso en otro caso (ES)',
      );
      expect(prisma.case.create).not.toHaveBeenCalled();
    });

    it('explains when the slug belongs to a deleted case', async () => {
      prisma.caseTranslation.findUnique.mockResolvedValue({
        caseId: 'other',
        case: { deletedAt: NOW },
      });
      await expect(
        service.create({
          type: 'SAAS',
          translations: { ES: { title: 'X', slug: 'viejo' } },
        }),
      ).rejects.toThrow('lo usa un caso eliminado');
    });

    it('requires at least one locale', async () => {
      await expect(
        service.create({ type: 'SAAS', translations: {} }),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps a unique violation from a concurrent request to 409', async () => {
      prisma.case.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
      );
      await expect(
        service.create({ type: 'SAAS', translations: { ES: { title: 'X' } } }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('updates case fields, replaces technologies in order and revalidates old and new slugs', async () => {
      prisma.technology.findMany.mockResolvedValue([
        { id: 'tech-2' },
        { id: 'tech-1' },
      ]);

      await service.update('case-1', {
        anonymizeClient: true,
        year: null,
        technologyIds: ['tech-2', 'tech-1'],
        translations: { ES: { slug: 'corte-maestro', summary: 'Nuevo' } },
      });

      expect(prisma.case.update).toHaveBeenCalledWith({
        where: { id: 'case-1' },
        data: expect.objectContaining({
          anonymizeClient: true,
          year: null,
          updatedAt: expect.any(Date),
        }),
      });
      expect(prisma.caseTechnology.deleteMany).toHaveBeenCalledWith({
        where: { caseId: 'case-1' },
      });
      expect(prisma.caseTechnology.createMany).toHaveBeenCalledWith({
        data: [
          { caseId: 'case-1', technologyId: 'tech-2', sortOrder: 1 },
          { caseId: 'case-1', technologyId: 'tech-1', sortOrder: 2 },
        ],
      });
      expect(prisma.caseTranslation.update).toHaveBeenCalledWith({
        where: { id: 'tr-ES' },
        data: expect.objectContaining({
          slug: 'corte-maestro',
          summary: 'Nuevo',
          blocks: undefined,
        }),
      });
      expect(lastTags()).toEqual(
        expect.arrayContaining([
          'cases',
          'stats',
          'case:cortemaestro',
          'case:corte-maestro',
          'case:cortemaestro-en',
        ]),
      );
    });

    it('returns 409 when the new slug belongs to another case', async () => {
      prisma.caseTranslation.findUnique.mockResolvedValue({
        caseId: 'case-2',
        case: { deletedAt: null },
      });

      await expect(
        service.update('case-1', { translations: { EN: { slug: 'taken' } } }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.caseTranslation.update).not.toHaveBeenCalled();
      expect(revalidation.revalidate).not.toHaveBeenCalled();
    });

    it('rejects gallery blocks that reference images of another case', async () => {
      await expect(
        service.update('case-1', {
          translations: {
            ES: {
              blocks: [{ type: 'gallery', imageIds: ['img-1', 'img-x'] }],
            },
          },
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.caseTranslation.update).not.toHaveBeenCalled();
    });

    it('stores validated blocks', async () => {
      await service.update('case-1', {
        translations: {
          ES: {
            blocks: [{ type: 'gallery', imageIds: ['img-2'], caption: null }],
          },
        },
      });
      expect(
        prisma.caseTranslation.update.mock.calls[0][0].data.blocks,
      ).toEqual([{ type: 'gallery', imageIds: ['img-2'] }]);
    });

    it('rejects unknown or deleted technologies', async () => {
      prisma.technology.findMany.mockResolvedValue([{ id: 'tech-1' }]);
      await expect(
        service.update('case-1', { technologyIds: ['tech-1', 'gone'] }),
      ).rejects.toThrow(
        'technologyIds contiene tecnologías inexistentes o eliminadas: gone',
      );
    });

    it('keeps a published translation published, but not incomplete (422)', async () => {
      prisma.case.findFirst.mockResolvedValue(
        caseRow({
          translations: [translation('ES', { status: 'PUBLISHED' })],
        }),
      );

      await service.update('case-1', {
        translations: { ES: { title: 'Nuevo' } },
      });
      expect(
        prisma.caseTranslation.update.mock.calls[0][0].data,
      ).not.toHaveProperty('status', 'DRAFT');

      const error = await rejection(
        service.update('case-1', {
          translations: { ES: { summary: '', blocks: [] } },
        }),
      );
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse()).toMatchObject({
        message:
          'La versión ES está publicada y no puede quedar incompleta. Falta: resumen, al menos un bloque',
        details: { locale: 'ES', missing: ['summary', 'blocks'] },
      });
    });

    it('creates a missing locale as a draft, generating its slug', async () => {
      prisma.case.findFirst.mockResolvedValue(
        caseRow({ translations: [translation('ES')] }),
      );

      await service.update('case-1', {
        translations: { EN: { title: 'Cutting tool', summary: 'Summary' } },
      });

      expect(prisma.caseTranslation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          caseId: 'case-1',
          locale: 'EN',
          title: 'Cutting tool',
          slug: 'cutting-tool',
          summary: 'Summary',
          blocks: [],
        }),
      });
      expect(
        prisma.caseTranslation.create.mock.calls[0][0].data,
      ).not.toHaveProperty('status');
    });

    it('requires a title to create a missing locale', async () => {
      prisma.case.findFirst.mockResolvedValue(
        caseRow({ translations: [translation('ES')] }),
      );
      await expect(
        service.update('case-1', { translations: { EN: { summary: 'x' } } }),
      ).rejects.toThrow(
        'translations.EN.title es obligatorio para crear la versión EN',
      );
    });
  });

  describe('publish', () => {
    it('returns 422 listing the missing fields in Spanish', async () => {
      prisma.case.findFirst.mockResolvedValue(
        caseRow({
          translations: [translation('EN', { summary: '  ', blocks: [] })],
        }),
      );

      const error = await rejection(service.publish('case-1', 'EN'));

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse()).toEqual({
        message:
          'No se puede publicar la versión EN. Falta: resumen, al menos un bloque',
        error: 'Unprocessable Entity',
        details: { locale: 'EN', missing: ['summary', 'blocks'] },
      });
      expect(prisma.caseTranslation.update).not.toHaveBeenCalled();
    });

    it('returns 422 with every field when the locale does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(
        caseRow({ translations: [translation('ES')] }),
      );
      const error = await rejection(service.publish('case-1', 'EN'));
      expect(error.getResponse()).toMatchObject({
        details: { missing: ['title', 'slug', 'summary', 'blocks'] },
      });
    });

    it('publishes and sets publishedAt the first time', async () => {
      await service.publish('case-1', 'ES');

      expect(prisma.caseTranslation.update).toHaveBeenCalledWith({
        where: { id: 'tr-ES' },
        data: { status: 'PUBLISHED', publishedAt: expect.any(Date) },
      });
      expect(lastTags()).toEqual([
        'cases',
        'stats',
        'case:cortemaestro',
        'case:cortemaestro-en',
      ]);
    });

    it('keeps the original publishedAt when republishing', async () => {
      prisma.case.findFirst.mockResolvedValue(
        caseRow({
          translations: [translation('ES', { publishedAt: PUBLISHED_AT })],
        }),
      );
      await service.publish('case-1', 'ES');
      expect(
        prisma.caseTranslation.update.mock.calls[0][0].data.publishedAt,
      ).toBe(PUBLISHED_AT);
    });
  });

  describe('unpublish', () => {
    it('sets DRAFT', async () => {
      await service.unpublish('case-1', 'EN');
      expect(prisma.caseTranslation.update).toHaveBeenCalledWith({
        where: { id: 'tr-EN' },
        data: { status: 'DRAFT' },
      });
      expect(revalidation.revalidate).toHaveBeenCalled();
    });

    it('returns 404 when the locale does not exist', async () => {
      prisma.case.findFirst.mockResolvedValue(
        caseRow({ translations: [translation('ES')] }),
      );
      await expect(service.unpublish('case-1', 'EN')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes and revalidates', async () => {
      await service.remove('case-1');
      expect(prisma.case.update).toHaveBeenCalledWith({
        where: { id: 'case-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(lastTags()).toContain('case:cortemaestro');
    });
  });

  describe('reorder', () => {
    beforeEach(() => {
      prisma.case.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
    });

    it('sets sortOrder from the position', async () => {
      await service.reorder(['c', 'a', 'b']);
      // Only rows whose position changes are written (updatedAt stays put).
      expect(prisma.case.updateMany.mock.calls.map(([args]) => args)).toEqual([
        { where: { id: 'c', NOT: { sortOrder: 1 } }, data: { sortOrder: 1 } },
        { where: { id: 'a', NOT: { sortOrder: 2 } }, data: { sortOrder: 2 } },
        { where: { id: 'b', NOT: { sortOrder: 3 } }, data: { sortOrder: 3 } },
      ]);
      expect(lastTags()).toEqual(['cases', 'stats']);
    });

    it('requires exactly the non-deleted ids', async () => {
      await expect(service.reorder(['a', 'b'])).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.case.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('images', () => {
    it('appends a new image at the end with its alt texts', async () => {
      prisma.caseImage.create.mockResolvedValue({
        id: 'img-3',
        url: 'https://cdn/3.png',
        alt: { ES: 'Tres' },
        sortOrder: 3,
      });

      const image = await service.addImage('case-1', {
        url: 'https://cdn/3.png',
        alt: { ES: 'Tres', EN: '' },
      });

      expect(prisma.caseImage.create).toHaveBeenCalledWith({
        data: {
          caseId: 'case-1',
          url: 'https://cdn/3.png',
          alt: { ES: 'Tres' },
          sortOrder: 3,
        },
      });
      expect(image).toEqual({
        id: 'img-3',
        url: 'https://cdn/3.png',
        alt: { ES: 'Tres', EN: null },
        sortOrder: 3,
      });
    });

    it('returns 404 when updating an image of another case', async () => {
      await expect(
        service.updateImage('case-1', 'img-x', { sortOrder: 1 }),
      ).rejects.toThrow(new NotFoundException(IMAGE_NOT_FOUND));
    });

    it('deleting an image removes it from the gallery blocks of every locale', async () => {
      await service.removeImage('case-1', 'img-1');

      expect(prisma.caseImage.delete).toHaveBeenCalledWith({
        where: { id: 'img-1' },
      });
      const updates = prisma.caseTranslation.update.mock.calls.map(
        ([args]) => args,
      );
      expect(updates).toEqual([
        {
          where: { id: 'tr-ES' },
          data: {
            blocks: [
              { type: 'text', title: 'El reto', body: 'Texto' },
              { type: 'gallery', imageIds: ['img-2'] },
            ],
          },
        },
        {
          where: { id: 'tr-EN' },
          data: {
            blocks: [
              { type: 'text', title: 'El reto', body: 'Texto' },
              { type: 'gallery', imageIds: ['img-2'] },
            ],
          },
        },
      ]);
    });

    it('returns 404 when deleting an unknown image', async () => {
      await expect(service.removeImage('case-1', 'img-x')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.caseImage.delete).not.toHaveBeenCalled();
    });
  });
});

describe('missingForCasePublish', () => {
  it('requires title, slug, summary and at least one block', () => {
    expect(
      missingForCasePublish({
        title: 'T',
        slug: 's',
        summary: 'S',
        blocks: [{ type: 'text', title: '', body: '' }],
      }),
    ).toEqual([]);
    expect(
      missingForCasePublish({
        title: ' ',
        slug: '',
        summary: '',
        blocks: null,
      }),
    ).toEqual(['title', 'slug', 'summary', 'blocks']);
  });
});

describe('mergeAlt', () => {
  it('keeps omitted locales, sets given ones and clears null or empty ones', () => {
    expect(mergeAlt({ ES: 'Uno', EN: 'One' }, { EN: null })).toEqual({
      ES: 'Uno',
    });
    expect(mergeAlt({ ES: 'Uno' }, { EN: 'One', ES: '' })).toEqual({
      EN: 'One',
    });
    expect(mergeAlt({ ES: 'Uno' }, undefined)).toEqual({ ES: 'Uno' });
    expect(mergeAlt('garbage', { ES: 'Uno' })).toEqual({ ES: 'Uno' });
  });
});
