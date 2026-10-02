import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CASE_NOT_FOUND, CasesService, nextInOrder } from './cases.service.js';

function detailRow(overrides: Record<string, unknown> = {}) {
  const { case: caseOverrides, ...rest } = overrides as {
    case?: Record<string, unknown>;
  };
  return {
    slug: 'cortemaestro',
    title: 'CorteMaestro',
    tagline: 'NestJS · React',
    summary: 'Resumen',
    industry: 'Carpintería',
    blocks: [
      { type: 'text', title: 'El reto', body: 'Texto' },
      { type: 'gallery', imageIds: ['img-1'] },
      { type: 'gallery', imageIds: [] },
      { type: 'metrics', items: [] },
    ],
    seoTitle: 'SEO',
    seoDescription: 'Descripción SEO',
    publishedAt: new Date('2026-10-01T10:00:00Z'),
    ...rest,
    case: {
      type: 'TOOL',
      year: 2026,
      coverImageUrl: null,
      client: 'Taller Pérez',
      anonymizeClient: false,
      technologies: [{ technology: { name: 'NestJS', slug: 'nestjs' } }],
      images: [
        {
          id: 'img-1',
          url: 'https://cdn/1.png',
          alt: { ES: 'Plano de corte', EN: 'Cutting plan' },
        },
      ],
      translations: [
        { locale: 'ES', slug: 'cortemaestro' },
        { locale: 'EN', slug: 'cortemaestro-en' },
      ],
      ...caseOverrides,
    },
  };
}

describe('CasesService', () => {
  const caseTranslation = { findFirst: vi.fn(), findMany: vi.fn() };
  const service = new CasesService({
    caseTranslation,
  } as unknown as PrismaService);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('list', () => {
    it('maps published translations of the locale, optionally filtered by type', async () => {
      caseTranslation.findMany.mockResolvedValue([
        {
          slug: 'contaflow-ia',
          title: 'ContaFlow IA',
          tagline: null,
          summary: 'SaaS contable',
          industry: null,
          case: {
            type: 'SAAS',
            year: 2025,
            coverImageUrl: 'https://cdn/c.png',
            technologies: [
              { technology: { name: '.NET Core', slug: 'dotnet-core' } },
            ],
          },
        },
      ]);

      const result = await service.list('en', 'SAAS');

      expect(result).toEqual([
        {
          slug: 'contaflow-ia',
          title: 'ContaFlow IA',
          tagline: null,
          summary: 'SaaS contable',
          type: 'SAAS',
          industry: null,
          year: 2025,
          coverImageUrl: 'https://cdn/c.png',
          technologies: [{ name: '.NET Core', slug: 'dotnet-core' }],
        },
      ]);
      const args = caseTranslation.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        locale: 'EN',
        status: 'PUBLISHED',
        case: { deletedAt: null, type: 'SAAS' },
      });
      expect(args.orderBy).toEqual([
        { case: { sortOrder: 'asc' } },
        { case: { createdAt: 'asc' } },
        { caseId: 'asc' },
      ]);
      // Chips exclude soft-deleted technologies.
      expect(args.select.case.select.technologies.where).toEqual({
        technology: { deletedAt: null },
      });
    });
  });

  describe('findBySlug', () => {
    beforeEach(() => {
      caseTranslation.findMany.mockResolvedValue([
        { slug: 'contaflow-ia', title: 'ContaFlow IA' },
        { slug: 'cortemaestro', title: 'CorteMaestro' },
        { slug: 'sla-manager', title: 'SLA Manager' },
      ]);
    });

    it('returns 404 when the slug is not published in that locale', async () => {
      caseTranslation.findFirst.mockResolvedValue(null);

      await expect(service.findBySlug('es', 'borrador')).rejects.toThrow(
        new NotFoundException(CASE_NOT_FOUND),
      );
      expect(caseTranslation.findFirst.mock.calls[0][0].where).toEqual({
        locale: 'ES',
        status: 'PUBLISHED',
        case: { deletedAt: null },
        slug: 'borrador',
      });
    });

    it('returns the detail with resolved blocks, alternates and the next case', async () => {
      caseTranslation.findFirst.mockResolvedValue(detailRow());

      const detail = await service.findBySlug('en', 'cortemaestro');

      expect(detail).toMatchObject({
        slug: 'cortemaestro',
        client: 'Taller Pérez',
        technologies: [{ name: 'NestJS', slug: 'nestjs' }],
        blocks: [
          { type: 'text', title: 'El reto', body: 'Texto' },
          {
            type: 'gallery',
            images: [{ url: 'https://cdn/1.png', alt: 'Cutting plan' }],
            caption: null,
          },
        ],
        publishedAt: '2026-10-01T10:00:00.000Z',
        alternates: { es: 'cortemaestro', en: 'cortemaestro-en' },
        next: { slug: 'sla-manager', title: 'SLA Manager' },
      });
      // Only published translations feed the alternates.
      expect(
        caseTranslation.findFirst.mock.calls[0][0].select.case.select
          .translations.where,
      ).toEqual({ status: 'PUBLISHED' });
    });

    it('hides the client when the case is anonymised', async () => {
      caseTranslation.findFirst.mockResolvedValue(
        detailRow({ case: { anonymizeClient: true } }),
      );

      const detail = await service.findBySlug('es', 'cortemaestro');

      expect(detail.client).toBeNull();
      expect(JSON.stringify(detail)).not.toContain('Taller Pérez');
    });

    it('returns null alternates for unpublished locales', async () => {
      caseTranslation.findFirst.mockResolvedValue(
        detailRow({
          case: { translations: [{ locale: 'ES', slug: 'cortemaestro' }] },
        }),
      );

      const detail = await service.findBySlug('es', 'cortemaestro');

      expect(detail.alternates).toEqual({ es: 'cortemaestro', en: null });
    });

    it('wraps around to the first case after the last one', async () => {
      caseTranslation.findFirst.mockResolvedValue(
        detailRow({ slug: 'sla-manager', title: 'SLA Manager' }),
      );

      const detail = await service.findBySlug('es', 'sla-manager');

      expect(detail.next).toEqual({
        slug: 'contaflow-ia',
        title: 'ContaFlow IA',
      });
    });
  });
});

describe('nextInOrder', () => {
  const list = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];

  it('returns the following item and wraps around', () => {
    expect(nextInOrder(list, 'a')).toEqual({ slug: 'b' });
    expect(nextInOrder(list, 'c')).toEqual({ slug: 'a' });
  });

  it('returns null for a single case or an unknown slug', () => {
    expect(nextInOrder([{ slug: 'a' }], 'a')).toBeNull();
    expect(nextInOrder(list, 'z')).toBeNull();
  });
});
