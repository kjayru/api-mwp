import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { KnowledgeSyncService } from '../knowledge/knowledge-sync.service.js';
import { AdminFaqsService, missingForFaqPublish } from './admin-faqs.service.js';

const NOW = new Date('2026-11-24T12:00:00Z');

function faqRow(translations: object[]) {
  return { id: 'faq-1', sortOrder: 1, createdAt: NOW, updatedAt: NOW, deletedAt: null, translations };
}

describe('AdminFaqsService', () => {
  const prisma = {
    faqDocument: { findFirst: vi.fn(), update: vi.fn() },
    faqDocumentTranslation: { update: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg as Promise<unknown>[]),
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

  it('missingForFaqPublish lists the empty fields', () => {
    expect(missingForFaqPublish({ question: '¿?', answer: '  ' })).toEqual(['answer']);
    expect(missingForFaqPublish(null)).toEqual(['question', 'answer']);
  });

  it('publishing an incomplete locale is a 422 and indexes nothing', async () => {
    prisma.faqDocument.findFirst.mockResolvedValue(
      faqRow([{ id: 't1', locale: 'ES', question: '¿Plazos?', answer: '', status: 'DRAFT', publishedAt: null }]),
    );
    const error = await service.publish('faq-1', 'ES').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      message: 'No se puede publicar la versión ES. Falta: respuesta',
      details: { locale: 'ES', missing: ['answer'] },
    });
    expect(knowledge.scheduleFaq).not.toHaveBeenCalled();
  });

  it('publishing schedules the knowledge sync of the FAQ', async () => {
    prisma.faqDocument.findFirst.mockResolvedValue(
      faqRow([{ id: 't1', locale: 'ES', question: '¿Plazos?', answer: 'Depende.', status: 'DRAFT', publishedAt: null }]),
    );
    await service.publish('faq-1', 'ES');
    expect(prisma.faqDocumentTranslation.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'PUBLISHED', publishedAt: expect.any(Date) },
    });
    expect(knowledge.scheduleFaq).toHaveBeenCalledWith('faq-1');
  });

  it('unknown or deleted FAQs are a 404', async () => {
    prisma.faqDocument.findFirst.mockResolvedValue(null);
    await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
