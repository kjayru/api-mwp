import type { Prisma } from '../../generated/prisma/client.js';
import { planCases, planFaqs } from './knowledge-sources.js';

describe('knowledge sources', () => {
  it('plans only published translations of non-deleted cases included in the knowledge base', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'case-1',
        type: 'TOOL',
        client: 'Taller',
        anonymizeClient: false,
        year: 2026,
        technologies: [{ technology: { name: 'NestJS', slug: 'nestjs' } }],
        translations: [
          {
            locale: 'ES',
            title: 'CorteMaestro',
            slug: 'cortemaestro',
            tagline: null,
            summary: 'Despiece',
            industry: null,
            blocks: [{ type: 'text', title: 'El reto', body: 'Texto' }],
          },
          {
            locale: 'EN',
            title: 'CorteMaestro',
            slug: 'cortemaestro-en',
            tagline: null,
            summary: 'Cutting lists',
            industry: null,
            blocks: [],
          },
        ],
      },
    ]);
    const db = { case: { findMany } } as unknown as Prisma.TransactionClient;

    const planned = await planCases(db, 'case-1');

    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      id: 'case-1',
      deletedAt: null,
      includeInKnowledgeBase: true,
    });
    expect(args.select.translations).toEqual({ where: { status: 'PUBLISHED' } });
    expect(planned.map((p) => [p.sourceType, p.sourceId, p.locale])).toEqual([
      ['CASE', 'case-1', 'ES'],
      ['CASE', 'case-1', 'EN'],
    ]);
    expect(planned[1].chunks[0].sourceKey).toBe('caso:cortemaestro-en#0');
  });

  it('skips published FAQ translations without an answer', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'faq-1',
        translations: [
          { locale: 'ES', question: '¿Plazos?', answer: 'Depende.' },
          { locale: 'EN', question: 'Timelines?', answer: '   ' },
        ],
      },
    ]);
    const db = { faqDocument: { findMany } } as unknown as Prisma.TransactionClient;

    const planned = await planFaqs(db);

    expect(findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    expect(planned.map((p) => p.locale)).toEqual(['ES']);
  });
});
