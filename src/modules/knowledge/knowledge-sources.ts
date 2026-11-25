// Reads the content that belongs in the knowledge base and plans its chunks.
// Eligible: published translations of non-deleted cases with
// includeInKnowledgeBase, and published translations of non-deleted FAQs.
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  KnowledgeSourceType,
  Locale,
} from '../../generated/prisma/enums.js';
import { type ChunkDraft, chunkCase, chunkFaq } from './chunking.js';

type Db = Prisma.TransactionClient;

/** The chunks one source translation should have right now. */
export interface PlannedSource {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  locale: Locale;
  title: string;
  chunks: ChunkDraft[];
}

export async function planCases(
  db: Db,
  caseId?: string,
): Promise<PlannedSource[]> {
  const rows = await db.case.findMany({
    where: {
      ...(caseId ? { id: caseId } : {}),
      deletedAt: null,
      includeInKnowledgeBase: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      type: true,
      client: true,
      anonymizeClient: true,
      year: true,
      translations: { where: { status: 'PUBLISHED' } },
      technologies: {
        where: { technology: { deletedAt: null } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { technology: { select: { name: true, slug: true } } },
      },
    },
  });
  return rows.flatMap((row) =>
    row.translations.map(
      (t): PlannedSource => ({
        sourceType: 'CASE',
        sourceId: row.id,
        locale: t.locale,
        title: t.title,
        chunks: chunkCase({
          caseId: row.id,
          type: row.type,
          client: row.client,
          anonymizeClient: row.anonymizeClient,
          year: row.year,
          technologies: row.technologies.map((link) => link.technology),
          locale: t.locale,
          title: t.title,
          slug: t.slug,
          tagline: t.tagline,
          summary: t.summary,
          industry: t.industry,
          blocks: t.blocks,
        }),
      }),
    ),
  );
}

export async function planFaqs(
  db: Db,
  faqId?: string,
): Promise<PlannedSource[]> {
  const rows = await db.faqDocument.findMany({
    where: { ...(faqId ? { id: faqId } : {}), deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      translations: { where: { status: 'PUBLISHED' } },
    },
  });
  return rows.flatMap((row) =>
    row.translations
      .filter((t) => t.question.trim() && t.answer.trim())
      .map(
        (t): PlannedSource => ({
          sourceType: 'FAQ',
          sourceId: row.id,
          locale: t.locale,
          title: t.question,
          chunks: chunkFaq({
            faqId: row.id,
            locale: t.locale,
            question: t.question,
            answer: t.answer,
          }),
        }),
      ),
  );
}

export async function planSource(
  db: Db,
  sourceType: KnowledgeSourceType,
  sourceId: string,
): Promise<PlannedSource[]> {
  return sourceType === 'CASE'
    ? planCases(db, sourceId)
    : planFaqs(db, sourceId);
}

export async function planAll(db: Db): Promise<PlannedSource[]> {
  return [...(await planCases(db)), ...(await planFaqs(db))];
}
