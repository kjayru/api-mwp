import { Injectable, NotFoundException } from '@nestjs/common';
import { type PublicLocale, toDbLocale } from '../../common/i18n/locale.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CaseType, Locale } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { resolvePublicBlocks } from './case-blocks.js';
import type {
  PublicCaseDetail,
  PublicCaseListItem,
  TechnologyChip,
} from './entities/public-case.entity.js';

export const CASE_NOT_FOUND = 'Caso no encontrado';

/** Published translations of non-deleted cases. */
function publishedIn(locale: Locale): Prisma.CaseTranslationWhereInput {
  return { locale, status: 'PUBLISHED', case: { deletedAt: null } };
}

/** Public order: Case.sortOrder, then Case.createdAt (id as a stable tiebreaker). */
const PUBLIC_ORDER: Prisma.CaseTranslationOrderByWithRelationInput[] = [
  { case: { sortOrder: 'asc' } },
  { case: { createdAt: 'asc' } },
  { caseId: 'asc' },
];

/** Chips: only non-deleted technologies, in the case's chip order. */
const TECHNOLOGY_CHIPS = {
  where: { technology: { deletedAt: null } },
  orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  select: { technology: { select: { name: true, slug: true } } },
} satisfies Prisma.Case$technologiesArgs;

const LIST_SELECT = {
  slug: true,
  title: true,
  tagline: true,
  summary: true,
  industry: true,
  case: {
    select: {
      type: true,
      year: true,
      coverImageUrl: true,
      technologies: TECHNOLOGY_CHIPS,
    },
  },
} satisfies Prisma.CaseTranslationSelect;

type ListRow = Prisma.CaseTranslationGetPayload<{ select: typeof LIST_SELECT }>;

function toChips(
  rows: { technology: { name: string; slug: string } }[],
): TechnologyChip[] {
  return rows.map(({ technology }) => ({
    name: technology.name,
    slug: technology.slug,
  }));
}

function toListItem(row: ListRow): PublicCaseListItem {
  return {
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    summary: row.summary,
    type: row.case.type,
    industry: row.industry,
    year: row.case.year,
    coverImageUrl: row.case.coverImageUrl,
    technologies: toChips(row.case.technologies),
  };
}

/**
 * Next case after `slug` in the ordered list, wrapping around to the first.
 * null when the list has a single case (or `slug` is not in it).
 */
export function nextInOrder<T extends { slug: string }>(
  ordered: readonly T[],
  slug: string,
): T | null {
  const index = ordered.findIndex((item) => item.slug === slug);
  if (index === -1 || ordered.length < 2) return null;
  return ordered[(index + 1) % ordered.length];
}

/** Read-only public case endpoints: published content only, per locale. */
@Injectable()
export class CasesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    publicLocale: PublicLocale,
    type?: CaseType,
  ): Promise<PublicCaseListItem[]> {
    const locale = toDbLocale(publicLocale);
    const rows = await this.prisma.caseTranslation.findMany({
      where: {
        ...publishedIn(locale),
        case: { deletedAt: null, ...(type ? { type } : {}) },
      },
      orderBy: PUBLIC_ORDER,
      select: LIST_SELECT,
    });
    return rows.map(toListItem);
  }

  async findBySlug(
    publicLocale: PublicLocale,
    slug: string,
  ): Promise<PublicCaseDetail> {
    const locale = toDbLocale(publicLocale);
    const row = await this.prisma.caseTranslation.findFirst({
      where: { ...publishedIn(locale), slug },
      select: {
        ...LIST_SELECT,
        blocks: true,
        seoTitle: true,
        seoDescription: true,
        publishedAt: true,
        case: {
          select: {
            ...LIST_SELECT.case.select,
            client: true,
            anonymizeClient: true,
            images: { select: { id: true, url: true, alt: true } },
            translations: {
              where: { status: 'PUBLISHED' },
              select: { locale: true, slug: true },
            },
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundException(CASE_NOT_FOUND);
    }

    const ordered = await this.prisma.caseTranslation.findMany({
      where: publishedIn(locale),
      orderBy: PUBLIC_ORDER,
      select: { slug: true, title: true },
    });
    const next = nextInOrder(ordered, row.slug);
    const alternate = (target: Locale) =>
      row.case.translations.find((t) => t.locale === target)?.slug ?? null;

    return {
      ...toListItem(row),
      client: row.case.anonymizeClient ? null : row.case.client,
      blocks: resolvePublicBlocks(row.blocks, row.case.images, locale),
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      alternates: { es: alternate('ES'), en: alternate('EN') },
      next: next ? { slug: next.slug, title: next.title } : null,
    };
  }
}
