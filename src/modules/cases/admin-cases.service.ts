import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LOCALES, type PerLocale } from '../../common/i18n/locale.js';
import type { Paginated } from '../../common/pagination/pagination.js';
import { rethrowUniqueAsConflict } from '../../common/prisma-errors.js';
import { incompleteForPublication, isBlank } from '../../common/publication.js';
import { assertIsPermutation } from '../../common/reorder.js';
import {
  RevalidationService,
  RevalidationTag,
} from '../../common/revalidation/revalidation.service.js';
import { slugify, uniqueSlug } from '../../common/slug.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Locale } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertTechnologiesExist } from '../technologies/technology-ids.js';
import {
  altFor,
  removeImageFromBlocks,
  storedBlocks,
  validateCaseBlocks,
} from './case-blocks.js';
import { CASE_NOT_FOUND } from './cases.service.js';
import type { CaseBlock } from './entities/case-block.entity.js';
import type { AdminCasesQueryDto } from './dto/admin-cases-query.dto.js';
import type {
  CreateCaseImageDto,
  ImageAltDto,
  UpdateCaseImageDto,
} from './dto/case-image.dto.js';
import type { CreateCaseDto } from './dto/create-case.dto.js';
import type {
  UpdateCaseDto,
  UpdateCaseTranslationDto,
} from './dto/update-case.dto.js';
import type {
  AdminCase,
  AdminCaseImage,
  AdminCaseListItem,
  AdminCaseTranslation,
} from './entities/admin-case.entity.js';

type Tx = Prisma.TransactionClient;

export const IMAGE_NOT_FOUND = 'Imagen no encontrada';

/** Fields a translation needs to be published (API names -> Spanish labels). */
export const CASE_PUBLISH_LABELS: Record<string, string> = {
  title: 'título',
  slug: 'slug',
  summary: 'resumen',
  blocks: 'al menos un bloque',
};

/** Missing publish requirements of a case translation (empty = publishable). */
export function missingForCasePublish(
  t: { title: string; slug: string; summary: string; blocks: unknown } | null,
): string[] {
  if (!t) return Object.keys(CASE_PUBLISH_LABELS);
  const missing: string[] = [];
  if (isBlank(t.title)) missing.push('title');
  if (isBlank(t.slug)) missing.push('slug');
  if (isBlank(t.summary)) missing.push('summary');
  if (storedBlocks(t.blocks).length === 0) missing.push('blocks');
  return missing;
}

const IMAGE_ORDER: Prisma.CaseImageOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
];

const ADMIN_CASE_INCLUDE = {
  translations: true,
  images: { orderBy: IMAGE_ORDER },
  technologies: {
    where: { technology: { deletedAt: null } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { technologyId: true },
  },
} satisfies Prisma.CaseInclude;

type AdminCaseRow = Prisma.CaseGetPayload<{
  include: typeof ADMIN_CASE_INCLUDE;
}>;

const LIST_SELECT = {
  id: true,
  type: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  coverImageUrl: true,
  translations: {
    select: { locale: true, title: true, slug: true, status: true },
  },
} satisfies Prisma.CaseSelect;

type ListRow = Prisma.CaseGetPayload<{ select: typeof LIST_SELECT }>;

function perLocale<T, R>(
  rows: (T & { locale: Locale })[],
  map: (row: T & { locale: Locale }) => R,
): PerLocale<R | null> {
  const result = { ES: null, EN: null } as PerLocale<R | null>;
  for (const row of rows) result[row.locale] = map(row);
  return result;
}

export function toAdminImage(image: {
  id: string;
  url: string;
  alt: unknown;
  sortOrder: number;
}): AdminCaseImage {
  return {
    id: image.id,
    url: image.url,
    alt: { ES: altFor(image.alt, 'ES'), EN: altFor(image.alt, 'EN') },
    sortOrder: image.sortOrder,
  };
}

function toAdminCase(row: AdminCaseRow): AdminCase {
  return {
    id: row.id,
    type: row.type,
    client: row.client,
    anonymizeClient: row.anonymizeClient,
    year: row.year,
    coverImageUrl: row.coverImageUrl,
    includeInKnowledgeBase: row.includeInKnowledgeBase,
    sortOrder: row.sortOrder,
    technologyIds: row.technologies.map((t) => t.technologyId),
    images: row.images.map(toAdminImage),
    translations: perLocale(row.translations, (t): AdminCaseTranslation => ({
      title: t.title,
      slug: t.slug,
      tagline: t.tagline,
      summary: t.summary,
      industry: t.industry,
      blocks: storedBlocks(t.blocks),
      seoTitle: t.seoTitle,
      seoDescription: t.seoDescription,
      status: t.status,
      publishedAt: t.publishedAt,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toListItem(row: ListRow): AdminCaseListItem {
  return {
    id: row.id,
    type: row.type,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt,
    coverImageUrl: row.coverImageUrl,
    translations: perLocale(row.translations, (t) => ({
      title: t.title,
      slug: t.slug,
      status: t.status,
    })),
  };
}

/** Title used to sort the admin list: ES, falling back to EN. */
function sortTitle(row: ListRow): string {
  const es = row.translations.find((t) => t.locale === 'ES');
  const en = row.translations.find((t) => t.locale === 'EN');
  return es?.title ?? en?.title ?? '';
}

/** `{ ES?, EN? }` alt patch merged into the stored Json; null or "" clears a locale. */
export function mergeAlt(
  current: unknown,
  patch: ImageAltDto | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const locale of LOCALES) {
    const existing = altFor(current, locale);
    if (existing !== null) result[locale] = existing;
  }
  if (!patch) return result;
  for (const locale of LOCALES) {
    const value = patch[locale];
    if (value === undefined) continue;
    if (value === null || value.trim() === '') delete result[locale];
    else result[locale] = value;
  }
  return result;
}

/** Admin CRUD of cases, their translations, images and order. */
@Injectable()
export class AdminCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(query: AdminCasesQueryDto): Promise<Paginated<AdminCaseListItem>> {
    const { page, limit, q, type, status, sort } = query;
    const order = query.order ?? (sort === 'updatedAt' ? 'desc' : 'asc');

    const and: Prisma.CaseWhereInput[] = [];
    if (q) {
      and.push({
        translations: {
          some: { title: { contains: q, mode: 'insensitive' } },
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
    const where: Prisma.CaseWhereInput = {
      deletedAt: null,
      ...(type ? { type } : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };

    if (sort === 'title') {
      // Titles live in the translations (to-many), which Prisma cannot order by.
      // The admin list is small (dozens of cases), so sort it in memory.
      const rows = await this.prisma.case.findMany({
        where,
        select: LIST_SELECT,
      });
      const collator = new Intl.Collator('es', { sensitivity: 'base' });
      rows.sort((a, b) => {
        const byTitle = collator.compare(sortTitle(a), sortTitle(b));
        return (
          (order === 'asc' ? byTitle : -byTitle) || a.id.localeCompare(b.id)
        );
      });
      const start = (page - 1) * limit;
      return {
        data: rows.slice(start, start + limit).map(toListItem),
        meta: { page, limit, total: rows.length },
      };
    }

    const orderBy: Prisma.CaseOrderByWithRelationInput[] =
      sort === 'updatedAt'
        ? [{ updatedAt: order }, { id: order }]
        : [{ sortOrder: order }, { createdAt: order }, { id: order }];
    const [rows, total] = await Promise.all([
      this.prisma.case.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: LIST_SELECT,
      }),
      this.prisma.case.count({ where }),
    ]);
    return { data: rows.map(toListItem), meta: { page, limit, total } };
  }

  async findOne(id: string): Promise<AdminCase> {
    return toAdminCase(await this.loadCase(this.prisma, id));
  }

  // ---------------------------------------------------------------------------
  // Create / update / publish
  // ---------------------------------------------------------------------------

  async create(dto: CreateCaseDto): Promise<AdminCase> {
    const requested = LOCALES.filter((locale) => dto.translations[locale]);
    if (requested.length === 0) {
      throw new BadRequestException(
        'translations debe incluir al menos una versión (ES o EN) con su título',
      );
    }

    const id = await this.prisma
      .$transaction(async (tx) => {
        const translations: Prisma.CaseTranslationCreateWithoutCaseInput[] = [];
        for (const locale of requested) {
          const { title, slug } = dto.translations[locale]!;
          translations.push({
            locale,
            title,
            slug: slug
              ? await this.assertSlugAvailable(tx, locale, slug)
              : await this.generateSlug(tx, locale, title),
            summary: '',
          });
        }
        const created = await tx.case.create({
          data: {
            type: dto.type,
            sortOrder: await this.nextSortOrder(tx),
            translations: { create: translations },
          },
          select: { id: true },
        });
        return created.id;
      })
      .catch(rethrowUniqueAsConflict);

    // A new case is a draft: nothing public changes, so no revalidation.
    return this.findOne(id);
  }

  async update(id: string, dto: UpdateCaseDto): Promise<AdminCase> {
    const slugs = await this.prisma
      .$transaction(async (tx) => {
        const current = await this.loadCase(tx, id);
        const affectedSlugs = current.translations.map((t) => t.slug);

        if (dto.technologyIds) {
          await assertTechnologiesExist(tx, dto.technologyIds);
        }

        for (const locale of LOCALES) {
          const patch = dto.translations?.[locale];
          if (!patch) continue;
          const slug = await this.applyTranslationPatch(
            tx,
            current,
            locale,
            patch,
          );
          affectedSlugs.push(slug);
        }

        await tx.case.update({
          where: { id },
          data: {
            type: dto.type,
            client: emptyToNull(dto.client),
            anonymizeClient: dto.anonymizeClient,
            year: dto.year,
            coverImageUrl: dto.coverImageUrl,
            includeInKnowledgeBase: dto.includeInKnowledgeBase,
            sortOrder: dto.sortOrder,
            // Translation, image and technology edits also count as a change.
            updatedAt: new Date(),
          },
        });

        if (dto.technologyIds) {
          await tx.caseTechnology.deleteMany({ where: { caseId: id } });
          await tx.caseTechnology.createMany({
            data: dto.technologyIds.map((technologyId, index) => ({
              caseId: id,
              technologyId,
              sortOrder: index + 1,
            })),
          });
        }
        return affectedSlugs;
      })
      .catch(rethrowUniqueAsConflict);

    this.notifyCaseChanged(slugs);
    return this.findOne(id);
  }

  /**
   * Applies a partial translation inside the update transaction, creating the
   * locale (DRAFT) when missing. Returns the resulting slug.
   */
  private async applyTranslationPatch(
    tx: Tx,
    current: AdminCaseRow,
    locale: Locale,
    patch: UpdateCaseTranslationDto,
  ): Promise<string> {
    const existing = current.translations.find((t) => t.locale === locale);
    const imageIds = new Set(current.images.map((image) => image.id));
    const blocks =
      patch.blocks === undefined
        ? undefined
        : validateCaseBlocks(patch.blocks, imageIds);

    if (!existing) {
      if (!patch.title) {
        throw new BadRequestException(
          `translations.${locale}.title es obligatorio para crear la versión ${locale}`,
        );
      }
      const slug = patch.slug
        ? await this.assertSlugAvailable(tx, locale, patch.slug, current.id)
        : await this.generateSlug(tx, locale, patch.title);
      await tx.caseTranslation.create({
        data: {
          caseId: current.id,
          locale,
          title: patch.title,
          slug,
          tagline: emptyToNull(patch.tagline),
          summary: patch.summary ?? '',
          industry: emptyToNull(patch.industry),
          blocks: toJson(blocks ?? []),
          seoTitle: emptyToNull(patch.seoTitle),
          seoDescription: emptyToNull(patch.seoDescription),
        },
      });
      return slug;
    }

    if (patch.slug !== undefined && patch.slug !== existing.slug) {
      await this.assertSlugAvailable(tx, locale, patch.slug, current.id);
    }
    const merged = {
      title: patch.title ?? existing.title,
      slug: patch.slug ?? existing.slug,
      summary: patch.summary ?? existing.summary,
      blocks: blocks ?? existing.blocks,
    };
    // Editing a published translation keeps it published, so it must stay complete.
    if (existing.status === 'PUBLISHED') {
      const missing = missingForCasePublish(merged);
      if (missing.length > 0) {
        throw incompleteForPublication(
          locale,
          missing,
          CASE_PUBLISH_LABELS,
          'keep-published',
        );
      }
    }
    await tx.caseTranslation.update({
      where: { id: existing.id },
      data: {
        title: patch.title,
        slug: patch.slug,
        tagline: emptyToNull(patch.tagline),
        summary: patch.summary,
        industry: emptyToNull(patch.industry),
        blocks: blocks === undefined ? undefined : toJson(blocks),
        seoTitle: emptyToNull(patch.seoTitle),
        seoDescription: emptyToNull(patch.seoDescription),
      },
    });
    return merged.slug;
  }

  async publish(id: string, locale: Locale): Promise<AdminCase> {
    const current = await this.loadCase(this.prisma, id);
    const translation =
      current.translations.find((t) => t.locale === locale) ?? null;
    const missing = missingForCasePublish(translation);
    if (missing.length > 0 || !translation) {
      throw incompleteForPublication(
        locale,
        missing,
        CASE_PUBLISH_LABELS,
        'publish',
      );
    }

    await this.prisma.$transaction([
      this.prisma.caseTranslation.update({
        where: { id: translation.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: translation.publishedAt ?? new Date(),
        },
      }),
      this.touch(id),
    ]);
    // TODO(Phase 4, ai-assistant): emit the "case published" event that triggers
    // the knowledge base indexing.
    this.notifyCaseChanged(current.translations.map((t) => t.slug));
    return this.findOne(id);
  }

  async unpublish(id: string, locale: Locale): Promise<AdminCase> {
    const current = await this.loadCase(this.prisma, id);
    const translation = current.translations.find((t) => t.locale === locale);
    if (!translation) {
      throw new NotFoundException(`El caso no tiene versión ${locale}`);
    }
    await this.prisma.$transaction([
      this.prisma.caseTranslation.update({
        where: { id: translation.id },
        data: { status: 'DRAFT' },
      }),
      this.touch(id),
    ]);
    this.notifyCaseChanged(current.translations.map((t) => t.slug));
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const current = await this.loadCase(this.prisma, id);
    await this.prisma.case.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.notifyCaseChanged(current.translations.map((t) => t.slug));
  }

  async reorder(ids: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.case.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      assertIsPermutation(
        ids,
        existing.map((row) => row.id),
      );
      for (const [index, id] of ids.entries()) {
        // Only rows whose position changes are written, so updatedAt stays put
        // for the rest.
        await tx.case.updateMany({
          where: { id, NOT: { sortOrder: index + 1 } },
          data: { sortOrder: index + 1 },
        });
      }
    });
    this.notifyCaseChanged([]);
  }

  // ---------------------------------------------------------------------------
  // Images
  // ---------------------------------------------------------------------------

  async addImage(id: string, dto: CreateCaseImageDto): Promise<AdminCaseImage> {
    const current = await this.loadCase(this.prisma, id);
    const last = current.images.reduce(
      (max, image) => Math.max(max, image.sortOrder),
      0,
    );
    const [image] = await this.prisma.$transaction([
      this.prisma.caseImage.create({
        data: {
          caseId: id,
          url: dto.url,
          alt: mergeAlt({}, dto.alt),
          sortOrder: last + 1,
        },
      }),
      this.touch(id),
    ]);
    this.notifyCaseChanged(current.translations.map((t) => t.slug));
    return toAdminImage(image);
  }

  async updateImage(
    id: string,
    imageId: string,
    dto: UpdateCaseImageDto,
  ): Promise<AdminCaseImage> {
    const current = await this.loadCase(this.prisma, id);
    const image = current.images.find((row) => row.id === imageId);
    if (!image) {
      throw new NotFoundException(IMAGE_NOT_FOUND);
    }
    const [updated] = await this.prisma.$transaction([
      this.prisma.caseImage.update({
        where: { id: imageId },
        data: {
          alt: dto.alt ? mergeAlt(image.alt, dto.alt) : undefined,
          sortOrder: dto.sortOrder,
        },
      }),
      this.touch(id),
    ]);
    this.notifyCaseChanged(current.translations.map((t) => t.slug));
    return toAdminImage(updated);
  }

  /** Deletes the image row and removes its id from every gallery block of the case. */
  async removeImage(id: string, imageId: string): Promise<void> {
    const current = await this.loadCase(this.prisma, id);
    if (!current.images.some((row) => row.id === imageId)) {
      throw new NotFoundException(IMAGE_NOT_FOUND);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.caseImage.delete({ where: { id: imageId } });
      for (const translation of current.translations) {
        const blocks = removeImageFromBlocks(translation.blocks, imageId);
        if (blocks) {
          await tx.caseTranslation.update({
            where: { id: translation.id },
            data: { blocks: toJson(blocks) },
          });
        }
      }
      await tx.case.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
    });
    this.notifyCaseChanged(current.translations.map((t) => t.slug));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async loadCase(db: Tx, id: string): Promise<AdminCaseRow> {
    const row = await db.case.findFirst({
      where: { id, deletedAt: null },
      include: ADMIN_CASE_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException(CASE_NOT_FOUND);
    }
    return row;
  }

  private touch(id: string) {
    return this.prisma.case.update({
      where: { id },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
  }

  private async nextSortOrder(tx: Tx): Promise<number> {
    const { _max } = await tx.case.aggregate({
      where: { deletedAt: null },
      _max: { sortOrder: true },
    });
    return (_max.sortOrder ?? 0) + 1;
  }

  /** 409 when another case already uses `slug` in `locale`. Returns the slug. */
  private async assertSlugAvailable(
    tx: Tx,
    locale: Locale,
    slug: string,
    caseId?: string,
  ): Promise<string> {
    const owner = await tx.caseTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      select: { caseId: true, case: { select: { deletedAt: true } } },
    });
    if (owner && owner.caseId !== caseId) {
      throw new ConflictException(
        owner.case.deletedAt
          ? `El slug "${slug}" (${locale}) lo usa un caso eliminado; elige otro`
          : `El slug "${slug}" ya está en uso en otro caso (${locale})`,
      );
    }
    return slug;
  }

  private generateSlug(tx: Tx, locale: Locale, title: string): Promise<string> {
    return uniqueSlug(
      slugify(title) || (locale === 'ES' ? 'caso' : 'case'),
      async (candidate) =>
        (await tx.caseTranslation.count({
          where: { locale, slug: candidate },
        })) > 0,
    );
  }

  private notifyCaseChanged(slugs: string[]): void {
    void this.revalidation.revalidate([
      RevalidationTag.cases,
      RevalidationTag.stats,
      ...slugs.map(RevalidationTag.case),
    ]);
  }
}

/** Optional text fields: "" is stored as null; undefined means "unchanged". */
function emptyToNull(
  value: string | null | undefined,
): string | null | undefined {
  return value === '' ? null : value;
}

function toJson(blocks: CaseBlock[]): Prisma.InputJsonValue {
  return blocks as unknown as Prisma.InputJsonValue;
}
