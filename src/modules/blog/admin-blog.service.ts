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
import {
  RevalidationService,
  RevalidationTag,
} from '../../common/revalidation/revalidation.service.js';
import { slugify, uniqueSlug } from '../../common/slug.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Locale } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertTechnologiesExist } from '../technologies/technology-ids.js';
import { BLOG_POST_NOT_FOUND } from './blog.service.js';
import type { AdminBlogQueryDto } from './dto/blog-query.dto.js';
import type {
  CreateBlogPostDto,
  UpdateBlogPostDto,
  UpdateBlogPostTranslationDto,
} from './dto/blog-post.dto.js';
import type {
  AdminBlogPost,
  AdminBlogPostListItem,
  AdminBlogPostTranslation,
} from './entities/blog.entity.js';

type Tx = Prisma.TransactionClient;

/** Fields a translation needs to be published (API names -> Spanish labels). */
export const BLOG_PUBLISH_LABELS: Record<string, string> = {
  title: 'título',
  slug: 'slug',
  excerpt: 'extracto',
  content: 'contenido',
};

/** Missing publish requirements of a post translation (empty = publishable). */
export function missingForBlogPublish(
  t: {
    title: string;
    slug: string;
    excerpt: string | null;
    content: string;
  } | null,
): string[] {
  if (!t) return Object.keys(BLOG_PUBLISH_LABELS);
  return (['title', 'slug', 'excerpt', 'content'] as const).filter((field) =>
    isBlank(t[field]),
  );
}

const ADMIN_INCLUDE = {
  translations: true,
  author: { select: { name: true } },
  technologies: {
    where: { technology: { deletedAt: null } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { technologyId: true },
  },
} satisfies Prisma.BlogPostInclude;

type AdminRow = Prisma.BlogPostGetPayload<{ include: typeof ADMIN_INCLUDE }>;

const LIST_SELECT = {
  id: true,
  coverImageUrl: true,
  updatedAt: true,
  author: { select: { name: true } },
  translations: {
    select: {
      locale: true,
      title: true,
      slug: true,
      status: true,
      publishedAt: true,
    },
  },
} satisfies Prisma.BlogPostSelect;

type ListRow = Prisma.BlogPostGetPayload<{ select: typeof LIST_SELECT }>;

function perLocale<T extends { locale: Locale }, R>(
  rows: T[],
  map: (row: T) => R,
): PerLocale<R | null> {
  const result = { ES: null, EN: null } as PerLocale<R | null>;
  for (const row of rows) result[row.locale] = map(row);
  return result;
}

function toAdminPost(row: AdminRow): AdminBlogPost {
  return {
    id: row.id,
    coverImageUrl: row.coverImageUrl,
    technologyIds: row.technologies.map((t) => t.technologyId),
    author: row.author ? { name: row.author.name } : null,
    translations: perLocale(
      row.translations,
      (t): AdminBlogPostTranslation => ({
        title: t.title,
        slug: t.slug,
        excerpt: t.excerpt,
        content: t.content,
        seoTitle: t.seoTitle,
        seoDescription: t.seoDescription,
        status: t.status,
        publishedAt: t.publishedAt,
      }),
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toListItem(row: ListRow): AdminBlogPostListItem {
  return {
    id: row.id,
    coverImageUrl: row.coverImageUrl,
    updatedAt: row.updatedAt,
    author: row.author ? { name: row.author.name } : null,
    translations: perLocale(row.translations, (t) => ({
      title: t.title,
      slug: t.slug,
      status: t.status,
      publishedAt: t.publishedAt,
    })),
  };
}

/** ES value, falling back to EN (used to sort the admin list in memory). */
function sortValue<K extends 'title' | 'publishedAt'>(
  row: ListRow,
  key: K,
): ListRow['translations'][number][K] | null {
  const es = row.translations.find((t) => t.locale === 'ES');
  const en = row.translations.find((t) => t.locale === 'EN');
  return es?.[key] ?? en?.[key] ?? null;
}

/**
 * Comparator of the in-memory admin sorts. Titles use a Spanish collator; for
 * publishedAt, posts never published go last in both directions.
 */
export function compareAdminRows(
  sort: 'title' | 'publishedAt',
  order: 'asc' | 'desc',
): (a: ListRow, b: ListRow) => number {
  const collator = new Intl.Collator('es', { sensitivity: 'base' });
  const sign = order === 'asc' ? 1 : -1;
  return (a, b) => {
    let result: number;
    if (sort === 'title') {
      result =
        sign *
        collator.compare(
          sortValue(a, 'title') ?? '',
          sortValue(b, 'title') ?? '',
        );
    } else {
      const x = sortValue(a, 'publishedAt');
      const y = sortValue(b, 'publishedAt');
      if (!x || !y) result = x ? -1 : y ? 1 : 0;
      else result = sign * (x.getTime() - y.getTime());
    }
    return result || a.id.localeCompare(b.id);
  };
}

/** Admin CRUD of blog posts and their translations. */
@Injectable()
export class AdminBlogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(
    query: AdminBlogQueryDto,
  ): Promise<Paginated<AdminBlogPostListItem>> {
    const { page, limit, q, status, sort } = query;
    const order = query.order ?? (sort === 'title' ? 'asc' : 'desc');

    const and: Prisma.BlogPostWhereInput[] = [];
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
    const where: Prisma.BlogPostWhereInput = {
      deletedAt: null,
      ...(and.length > 0 ? { AND: and } : {}),
    };

    if (sort !== 'updatedAt') {
      // Titles and publication dates live in the translations (to-many), which
      // Prisma cannot order by. The admin list is small, so sort it in memory.
      const rows = await this.prisma.blogPost.findMany({
        where,
        select: LIST_SELECT,
      });
      rows.sort(compareAdminRows(sort, order));
      const start = (page - 1) * limit;
      return {
        data: rows.slice(start, start + limit).map(toListItem),
        meta: { page, limit, total: rows.length },
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: [{ updatedAt: order }, { id: order }],
        skip: (page - 1) * limit,
        take: limit,
        select: LIST_SELECT,
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { data: rows.map(toListItem), meta: { page, limit, total } };
  }

  async findOne(id: string): Promise<AdminBlogPost> {
    return toAdminPost(await this.load(this.prisma, id));
  }

  // ---------------------------------------------------------------------------
  // Create / update / publish / delete
  // ---------------------------------------------------------------------------

  /** `authorId`: the current user (stored as null if that user does not exist). */
  async create(
    dto: CreateBlogPostDto,
    authorId: string,
  ): Promise<AdminBlogPost> {
    const requested = LOCALES.filter((locale) => dto.translations[locale]);
    if (requested.length === 0) {
      throw new BadRequestException(
        'translations debe incluir al menos una versión (ES o EN) con su título',
      );
    }

    const id = await this.prisma
      .$transaction(async (tx) => {
        const translations: Prisma.BlogPostTranslationCreateWithoutBlogPostInput[] =
          [];
        for (const locale of requested) {
          const { title, slug } = dto.translations[locale]!;
          translations.push({
            locale,
            title,
            slug: slug
              ? await this.assertSlugAvailable(tx, locale, slug)
              : await this.generateSlug(tx, locale, title),
            content: '',
          });
        }
        const author = await tx.user.findUnique({
          where: { id: authorId },
          select: { id: true },
        });
        const created = await tx.blogPost.create({
          data: {
            authorId: author?.id ?? null,
            translations: { create: translations },
          },
          select: { id: true },
        });
        return created.id;
      })
      .catch(rethrowUniqueAsConflict);

    // A new post is a draft: nothing public changes, so no revalidation.
    return this.findOne(id);
  }

  async update(id: string, dto: UpdateBlogPostDto): Promise<AdminBlogPost> {
    const slugs = await this.prisma
      .$transaction(async (tx) => {
        const current = await this.load(tx, id);
        const affectedSlugs = current.translations.map((t) => t.slug);

        if (dto.technologyIds) {
          await assertTechnologiesExist(tx, dto.technologyIds);
        }
        for (const locale of LOCALES) {
          const patch = dto.translations?.[locale];
          if (!patch) continue;
          affectedSlugs.push(
            await this.applyTranslationPatch(tx, current, locale, patch),
          );
        }

        await tx.blogPost.update({
          where: { id },
          data: {
            coverImageUrl: dto.coverImageUrl,
            // Translation and technology edits also count as a change.
            updatedAt: new Date(),
          },
        });
        if (dto.technologyIds) {
          await tx.blogPostTechnology.deleteMany({ where: { blogPostId: id } });
          await tx.blogPostTechnology.createMany({
            data: dto.technologyIds.map((technologyId, index) => ({
              blogPostId: id,
              technologyId,
              sortOrder: index + 1,
            })),
          });
        }
        return affectedSlugs;
      })
      .catch(rethrowUniqueAsConflict);

    this.notify(slugs);
    return this.findOne(id);
  }

  /**
   * Applies a partial translation inside the update transaction, creating the
   * locale (DRAFT) when missing. Returns the resulting slug.
   */
  private async applyTranslationPatch(
    tx: Tx,
    current: AdminRow,
    locale: Locale,
    patch: UpdateBlogPostTranslationDto,
  ): Promise<string> {
    const existing = current.translations.find((t) => t.locale === locale);

    if (!existing) {
      if (!patch.title) {
        throw new BadRequestException(
          `translations.${locale}.title es obligatorio para crear la versión ${locale}`,
        );
      }
      const slug = patch.slug
        ? await this.assertSlugAvailable(tx, locale, patch.slug, current.id)
        : await this.generateSlug(tx, locale, patch.title);
      await tx.blogPostTranslation.create({
        data: {
          blogPostId: current.id,
          locale,
          title: patch.title,
          slug,
          excerpt: emptyToNull(patch.excerpt),
          content: patch.content ?? '',
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
      excerpt: patch.excerpt === undefined ? existing.excerpt : patch.excerpt,
      content: patch.content ?? existing.content,
    };
    // Editing a published translation keeps it published, so it must stay complete.
    if (existing.status === 'PUBLISHED') {
      const missing = missingForBlogPublish(merged);
      if (missing.length > 0) {
        throw incompleteForPublication(
          locale,
          missing,
          BLOG_PUBLISH_LABELS,
          'keep-published',
        );
      }
    }
    await tx.blogPostTranslation.update({
      where: { id: existing.id },
      data: {
        title: patch.title,
        slug: patch.slug,
        excerpt: emptyToNull(patch.excerpt),
        content: patch.content,
        seoTitle: emptyToNull(patch.seoTitle),
        seoDescription: emptyToNull(patch.seoDescription),
      },
    });
    return merged.slug;
  }

  async publish(id: string, locale: Locale): Promise<AdminBlogPost> {
    const current = await this.load(this.prisma, id);
    const translation =
      current.translations.find((t) => t.locale === locale) ?? null;
    const missing = missingForBlogPublish(translation);
    if (missing.length > 0 || !translation) {
      throw incompleteForPublication(
        locale,
        missing,
        BLOG_PUBLISH_LABELS,
        'publish',
      );
    }
    await this.prisma.$transaction([
      this.prisma.blogPostTranslation.update({
        where: { id: translation.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: translation.publishedAt ?? new Date(),
        },
      }),
      this.touch(id),
    ]);
    this.notify(current.translations.map((t) => t.slug));
    return this.findOne(id);
  }

  async unpublish(id: string, locale: Locale): Promise<AdminBlogPost> {
    const current = await this.load(this.prisma, id);
    const translation = current.translations.find((t) => t.locale === locale);
    if (!translation) {
      throw new NotFoundException(`El artículo no tiene versión ${locale}`);
    }
    await this.prisma.$transaction([
      this.prisma.blogPostTranslation.update({
        where: { id: translation.id },
        data: { status: 'DRAFT' },
      }),
      this.touch(id),
    ]);
    this.notify(current.translations.map((t) => t.slug));
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const current = await this.load(this.prisma, id);
    await this.prisma.blogPost.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.notify(current.translations.map((t) => t.slug));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** `blog` (list and every detail) plus `post:<slug>` for each given slug. */
  private notify(slugs: string[]): void {
    void this.revalidation.revalidate([
      RevalidationTag.blog,
      ...slugs.map(RevalidationTag.post),
    ]);
  }

  private async load(db: Tx, id: string): Promise<AdminRow> {
    const row = await db.blogPost.findFirst({
      where: { id, deletedAt: null },
      include: ADMIN_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException(BLOG_POST_NOT_FOUND);
    }
    return row;
  }

  private touch(id: string) {
    return this.prisma.blogPost.update({
      where: { id },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
  }

  /** 409 when another post already uses `slug` in `locale`. Returns the slug. */
  private async assertSlugAvailable(
    tx: Tx,
    locale: Locale,
    slug: string,
    blogPostId?: string,
  ): Promise<string> {
    const owner = await tx.blogPostTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      select: { blogPostId: true, blogPost: { select: { deletedAt: true } } },
    });
    if (owner && owner.blogPostId !== blogPostId) {
      throw new ConflictException(
        owner.blogPost.deletedAt
          ? `El slug "${slug}" (${locale}) lo usa un artículo eliminado; elige otro`
          : `El slug "${slug}" ya está en uso en otro artículo (${locale})`,
      );
    }
    return slug;
  }

  private generateSlug(tx: Tx, locale: Locale, title: string): Promise<string> {
    return uniqueSlug(
      slugify(title) || (locale === 'ES' ? 'articulo' : 'post'),
      async (candidate) =>
        (await tx.blogPostTranslation.count({
          where: { locale, slug: candidate },
        })) > 0,
    );
  }
}

/** Optional text fields: "" is stored as null; undefined means "unchanged". */
function emptyToNull(
  value: string | null | undefined,
): string | null | undefined {
  return value === '' ? null : value;
}
