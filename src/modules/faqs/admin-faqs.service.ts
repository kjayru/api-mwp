import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LOCALES, type PerLocale } from '../../common/i18n/locale.js';
import type { Paginated } from '../../common/pagination/pagination.js';
import { incompleteForPublication, isBlank } from '../../common/publication.js';
import { assertIsPermutation } from '../../common/reorder.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  Locale,
  PublicationStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KnowledgeSyncService } from '../knowledge/knowledge-sync.service.js';
import type {
  AdminFaqsQueryDto,
  CreateFaqDto,
  UpdateFaqDto,
} from './dto/faq.dto.js';

export const FAQ_NOT_FOUND = 'Pregunta frecuente no encontrada';

export const FAQ_PUBLISH_LABELS: Record<string, string> = {
  question: 'pregunta',
  answer: 'respuesta',
};

export interface AdminFaqTranslation {
  question: string;
  /** Markdown ("" until written). */
  answer: string;
  status: PublicationStatus;
  publishedAt: Date | null;
}

/** Returned by every /admin/faqs endpoint. */
export interface AdminFaq {
  id: string;
  sortOrder: number;
  translations: PerLocale<AdminFaqTranslation | null>;
  createdAt: Date;
  updatedAt: Date;
}

export function missingForFaqPublish(
  t: { question: string; answer: string } | null,
): string[] {
  if (!t) return Object.keys(FAQ_PUBLISH_LABELS);
  return (['question', 'answer'] as const).filter((field) => isBlank(t[field]));
}

const INCLUDE = { translations: true } satisfies Prisma.FaqDocumentInclude;
type Row = Prisma.FaqDocumentGetPayload<{ include: typeof INCLUDE }>;

function toAdminFaq(row: Row): AdminFaq {
  const translations = { ES: null, EN: null } as PerLocale<AdminFaqTranslation | null>;
  for (const t of row.translations) {
    translations[t.locale] = {
      question: t.question,
      answer: t.answer,
      status: t.status,
      publishedAt: t.publishedAt,
    };
  }
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    translations,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Admin CRUD of the FAQs of the knowledge base. Every change schedules a
 * knowledge sync of the FAQ (only published translations are indexed).
 */
@Injectable()
export class AdminFaqsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeSyncService,
  ) {}

  async list(query: AdminFaqsQueryDto): Promise<Paginated<AdminFaq>> {
    const { page, limit, q, status } = query;
    const and: Prisma.FaqDocumentWhereInput[] = [];
    if (q) {
      and.push({
        translations: {
          some: {
            OR: [
              { question: { contains: q, mode: 'insensitive' } },
              { answer: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      });
    }
    if (status) {
      and.push({
        translations: {
          some: { status: status === 'published' ? 'PUBLISHED' : 'DRAFT' },
        },
      });
    }
    const where: Prisma.FaqDocumentWhereInput = {
      deletedAt: null,
      ...(and.length > 0 ? { AND: and } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.faqDocument.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.faqDocument.count({ where }),
    ]);
    return { data: rows.map(toAdminFaq), meta: { page, limit, total } };
  }

  async findOne(id: string): Promise<AdminFaq> {
    return toAdminFaq(await this.load(id));
  }

  async create(dto: CreateFaqDto): Promise<AdminFaq> {
    const requested = LOCALES.filter((locale) => dto.translations[locale]);
    if (requested.length === 0) {
      throw new BadRequestException(
        'translations debe incluir al menos una versión (ES o EN) con su pregunta',
      );
    }
    const { _max } = await this.prisma.faqDocument.aggregate({
      where: { deletedAt: null },
      _max: { sortOrder: true },
    });
    const created = await this.prisma.faqDocument.create({
      data: {
        sortOrder: (_max.sortOrder ?? 0) + 1,
        translations: {
          create: requested.map((locale) => ({
            locale,
            question: dto.translations[locale]!.question,
            answer: dto.translations[locale]!.answer ?? '',
          })),
        },
      },
      select: { id: true },
    });
    // New FAQs are drafts: nothing to index yet.
    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdateFaqDto): Promise<AdminFaq> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.load(id, tx);
      for (const locale of LOCALES) {
        const patch = dto.translations?.[locale];
        if (!patch) continue;
        const existing = current.translations.find((t) => t.locale === locale);
        if (!existing) {
          if (!patch.question) {
            throw new BadRequestException(
              `translations.${locale}.question es obligatoria para crear la versión ${locale}`,
            );
          }
          await tx.faqDocumentTranslation.create({
            data: {
              faqDocumentId: id,
              locale,
              question: patch.question,
              answer: patch.answer ?? '',
            },
          });
          continue;
        }
        const merged = {
          question: patch.question ?? existing.question,
          answer: patch.answer ?? existing.answer,
        };
        if (existing.status === 'PUBLISHED') {
          const missing = missingForFaqPublish(merged);
          if (missing.length > 0) {
            throw incompleteForPublication(
              locale,
              missing,
              FAQ_PUBLISH_LABELS,
              'keep-published',
            );
          }
        }
        await tx.faqDocumentTranslation.update({
          where: { id: existing.id },
          data: { question: patch.question, answer: patch.answer },
        });
      }
      await tx.faqDocument.update({
        where: { id },
        data: { sortOrder: dto.sortOrder, updatedAt: new Date() },
      });
    });
    this.knowledge.scheduleFaq(id);
    return this.findOne(id);
  }

  async publish(id: string, locale: Locale): Promise<AdminFaq> {
    const current = await this.load(id);
    const translation =
      current.translations.find((t) => t.locale === locale) ?? null;
    const missing = missingForFaqPublish(translation);
    if (missing.length > 0 || !translation) {
      throw incompleteForPublication(
        locale,
        missing,
        FAQ_PUBLISH_LABELS,
        'publish',
      );
    }
    await this.prisma.$transaction([
      this.prisma.faqDocumentTranslation.update({
        where: { id: translation.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: translation.publishedAt ?? new Date(),
        },
      }),
      this.touch(id),
    ]);
    this.knowledge.scheduleFaq(id);
    return this.findOne(id);
  }

  async unpublish(id: string, locale: Locale): Promise<AdminFaq> {
    const current = await this.load(id);
    const translation = current.translations.find((t) => t.locale === locale);
    if (!translation) {
      throw new NotFoundException(
        `La pregunta frecuente no tiene versión ${locale}`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.faqDocumentTranslation.update({
        where: { id: translation.id },
        data: { status: 'DRAFT' },
      }),
      this.touch(id),
    ]);
    this.knowledge.scheduleFaq(id);
    return this.findOne(id);
  }

  /**
   * Sets sortOrder to the position (1..n) in `ids`, which must hold every
   * non-deleted FAQ once. The order does not change what the assistant
   * answers, so nothing is reindexed.
   */
  async reorder(ids: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.faqDocument.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      assertIsPermutation(
        ids,
        existing.map((row) => row.id),
      );
      for (const [index, id] of ids.entries()) {
        // Only rows whose position changes are written.
        await tx.faqDocument.updateMany({
          where: { id, NOT: { sortOrder: index + 1 } },
          data: { sortOrder: index + 1 },
        });
      }
    });
  }

  async remove(id: string): Promise<void> {
    await this.load(id);
    await this.prisma.faqDocument.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.knowledge.scheduleFaq(id);
  }

  private async load(
    id: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Row> {
    const row = await db.faqDocument.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException(FAQ_NOT_FOUND);
    return row;
  }

  private touch(id: string) {
    return this.prisma.faqDocument.update({
      where: { id },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
  }
}
