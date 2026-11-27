import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { KnowledgeSyncService } from '../knowledge/knowledge-sync.service.js';
import { AdminFaqsService } from './admin-faqs.service.js';

const NOW = new Date('2026-11-24T12:00:00Z');

const tr = (locale: 'ES' | 'EN', over: object = {}) => ({
  id: `t-${locale}`,
  locale,
  question: `Q ${locale}`,
  answer: `A ${locale}`,
  status: 'DRAFT',
  publishedAt: null,
  ...over,
});
const faqRow = (translations: object[]) => ({
  id: 'faq-1',
  sortOrder: 1,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  translations,
});

describe('AdminFaqsService (list, create, update, publish, unpublish, remove)', () => {
  const prisma = {
    faqDocument: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    faqDocumentTranslation: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function'
        ? arg(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  const knowledge = { scheduleFaq: vi.fn() };
  let service: AdminFaqsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AdminFaqsService(
      prisma as unknown as PrismaService,
      knowledge as unknown as KnowledgeSyncService,
    );
  });

  describe('list', () => {
    beforeEach(() => {
      prisma.faqDocument.findMany.mockResolvedValue([
        faqRow([tr('ES', { status: 'PUBLISHED', publishedAt: NOW })]),
      ]);
      prisma.faqDocument.count.mockResolvedValue(41);
    });

    it('paginates, maps translations per locale and reports the total', async () => {
      const out = await service.list({ page: 3, limit: 10 } as never);

      expect(prisma.faqDocument.findMany.mock.calls[0][0]).toMatchObject({
        where: { deletedAt: null },
        skip: 20,
        take: 10,
      });
      expect(out.meta).toEqual({ page: 3, limit: 10, total: 41 });
      expect(out.data[0].translations.EN).toBeNull();
      expect(out.data[0].translations.ES).toEqual({
        question: 'Q ES',
        answer: 'A ES',
        status: 'PUBLISHED',
        publishedAt: NOW,
      });
    });

    it('adds the text search and status filters', async () => {
      await service.list({
        page: 1,
        limit: 20,
        q: 'plazo',
        status: 'published',
      } as never);
      const where = prisma.faqDocument.findMany.mock.calls[0][0].where;
      expect(where.AND).toHaveLength(2);
      expect(where.AND[0].translations.some.OR).toEqual([
        { question: { contains: 'plazo', mode: 'insensitive' } },
        { answer: { contains: 'plazo', mode: 'insensitive' } },
      ]);
      expect(where.AND[1]).toEqual({
        translations: { some: { status: 'PUBLISHED' } },
      });
    });

    it('maps status=draft to DRAFT', async () => {
      await service.list({ page: 1, limit: 20, status: 'draft' } as never);
      expect(
        prisma.faqDocument.findMany.mock.calls[0][0].where.AND[0],
      ).toEqual({ translations: { some: { status: 'DRAFT' } } });
    });
  });

  describe('findOne', () => {
    it('404 when missing', async () => {
      prisma.faqDocument.findFirst.mockResolvedValue(null);
      await expect(service.findOne('x')).rejects.toThrow(
        'Pregunta frecuente no encontrada',
      );
    });
  });

  describe('create', () => {
    it('rejects a body without any translation', async () => {
      await expect(
        service.create({ translations: {} } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.faqDocument.create).not.toHaveBeenCalled();
    });

    it('creates drafts at the end of the list, with an empty answer by default', async () => {
      prisma.faqDocument.aggregate.mockResolvedValue({
        _max: { sortOrder: 4 },
      });
      prisma.faqDocument.create.mockResolvedValue({ id: 'faq-1' });
      prisma.faqDocument.findFirst.mockResolvedValue(faqRow([tr('EN')]));

      const out = await service.create({
        translations: { EN: { question: 'Q EN' } },
      } as never);

      expect(prisma.faqDocument.create.mock.calls[0][0].data).toEqual({
        sortOrder: 5,
        translations: {
          create: [{ locale: 'EN', question: 'Q EN', answer: '' }],
        },
      });
      expect(out.id).toBe('faq-1');
      expect(knowledge.scheduleFaq).not.toHaveBeenCalled();
    });

    it('starts at sortOrder 1 when there are no FAQs', async () => {
      prisma.faqDocument.aggregate.mockResolvedValue({
        _max: { sortOrder: null },
      });
      prisma.faqDocument.create.mockResolvedValue({ id: 'faq-1' });
      prisma.faqDocument.findFirst.mockResolvedValue(faqRow([tr('ES')]));
      await service.create({
        translations: { ES: { question: 'Q', answer: 'A' } },
      } as never);
      expect(prisma.faqDocument.create.mock.calls[0][0].data.sortOrder).toBe(1);
    });
  });

  describe('update', () => {
    it('404 for an unknown FAQ and schedules nothing', async () => {
      prisma.faqDocument.findFirst.mockResolvedValue(null);
      await expect(
        service.update('x', { translations: {} } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(knowledge.scheduleFaq).not.toHaveBeenCalled();
    });

    it('requires a question to create a missing locale', async () => {
      prisma.faqDocument.findFirst.mockResolvedValue(faqRow([tr('ES')]));
      const error = await service
        .update('faq-1', { translations: { EN: { answer: 'only' } } } as never)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('translations.EN.question');
      expect(prisma.faqDocumentTranslation.create).not.toHaveBeenCalled();
    });

    it('creates a missing locale, updates an existing one and schedules the sync', async () => {
      prisma.faqDocument.findFirst.mockResolvedValue(faqRow([tr('ES')]));

      await service.update('faq-1', {
        sortOrder: 7,
        translations: {
          EN: { question: 'New Q' },
          ES: { answer: 'New A' },
        },
      } as never);

      expect(prisma.faqDocumentTranslation.create).toHaveBeenCalledWith({
        data: {
          faqDocumentId: 'faq-1',
          locale: 'EN',
          question: 'New Q',
          answer: '',
        },
      });
      expect(prisma.faqDocumentTranslation.update).toHaveBeenCalledWith({
        where: { id: 't-ES' },
        data: { question: undefined, answer: 'New A' },
      });
      expect(prisma.faqDocument.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'faq-1' },
        data: { sortOrder: 7 },
      });
      expect(knowledge.scheduleFaq).toHaveBeenCalledWith('faq-1');
    });

    it('does not let a published translation become incomplete (422)', async () => {
      prisma.faqDocument.findFirst.mockResolvedValue(
        faqRow([tr('ES', { status: 'PUBLISHED' })]),
      );
      const error = await service
        .update('faq-1', {
          translations: { ES: { answer: '   ' } },
        } as never)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
        {
          message:
            'La versión ES está publicada y no puede quedar incompleta. Falta: respuesta',
          details: { locale: 'ES', missing: ['answer'] },
        },
      );
      expect(prisma.faqDocumentTranslation.update).not.toHaveBeenCalled();
      expect(knowledge.scheduleFaq).not.toHaveBeenCalled();
    });

    it('allows emptying the answer of a draft translation', async () => {
      prisma.faqDocument.findFirst.mockResolvedValue(faqRow([tr('ES')]));
      await service.update('faq-1', {
        translations: { ES: { answer: '' } },
      } as never);
      expect(prisma.faqDocumentTranslation.update).toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('keeps the original publishedAt when republishing', async () => {
      const first = new Date('2026-01-01T00:00:00Z');
      prisma.faqDocument.findFirst.mockResolvedValue(
        faqRow([tr('ES', { publishedAt: first })]),
      );
      await service.publish('faq-1', 'ES');
      expect(
        prisma.faqDocumentTranslation.update.mock.calls[0][0].data.publishedAt,
      ).toBe(first);
    });

    it('422 when the locale does not exist yet, listing every field', async () => {
      prisma.faqDocument.findFirst.mockResolvedValue(faqRow([tr('ES')]));
      const error = await service.publish('faq-1', 'EN').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject(
        { details: { locale: 'EN', missing: ['question', 'answer'] } },
      );
    });
  });

  describe('unpublish', () => {
    it('moves the translation back to draft and schedules the sync', async () => {
      prisma.faqDocument.findFirst.mockResolvedValue(
        faqRow([tr('ES', { status: 'PUBLISHED' })]),
      );
      await service.unpublish('faq-1', 'ES');
      expect(prisma.faqDocumentTranslation.update).toHaveBeenCalledWith({
        where: { id: 't-ES' },
        data: { status: 'DRAFT' },
      });
      expect(knowledge.scheduleFaq).toHaveBeenCalledWith('faq-1');
    });

    it('404 when the locale does not exist', async () => {
      prisma.faqDocument.findFirst.mockResolvedValue(faqRow([tr('ES')]));
      await expect(service.unpublish('faq-1', 'EN')).rejects.toThrow(
        'La pregunta frecuente no tiene versión EN',
      );
      expect(knowledge.scheduleFaq).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft deletes and schedules the sync so the FAQ leaves the index', async () => {
      prisma.faqDocument.findFirst.mockResolvedValue(faqRow([tr('ES')]));
      await service.remove('faq-1');
      expect(prisma.faqDocument.update).toHaveBeenCalledWith({
        where: { id: 'faq-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(knowledge.scheduleFaq).toHaveBeenCalledWith('faq-1');
    });
  });
});
