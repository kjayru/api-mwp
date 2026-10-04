import { Injectable, NotFoundException } from '@nestjs/common';
import { type PublicLocale, toDbLocale } from '../../common/i18n/locale.js';
import type { Paginated } from '../../common/pagination/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Locale } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  BlogPostLink,
  PublicBlogPostDetail,
  PublicBlogPostListItem,
} from './entities/blog.entity.js';
import { readingMinutes } from './reading-time.js';

export const BLOG_POST_NOT_FOUND = 'Artículo no encontrado';

/** Published translations of non-deleted posts. */
function publishedIn(locale: Locale): Prisma.BlogPostTranslationWhereInput {
  return { locale, status: 'PUBLISHED', blogPost: { deletedAt: null } };
}

/** Newest first: publishedAt, then the post's createdAt (id as a stable tiebreaker). */
export const PUBLIC_BLOG_ORDER: Prisma.BlogPostTranslationOrderByWithRelationInput[] =
  [
    { publishedAt: { sort: 'desc', nulls: 'last' } },
    { blogPost: { createdAt: 'desc' } },
    { blogPostId: 'desc' },
  ];

const LIST_SELECT = {
  slug: true,
  title: true,
  excerpt: true,
  content: true,
  publishedAt: true,
  updatedAt: true,
  blogPost: {
    select: {
      coverImageUrl: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { name: true } },
      technologies: {
        where: { technology: { deletedAt: null } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { technology: { select: { name: true, slug: true } } },
      },
    },
  },
} satisfies Prisma.BlogPostTranslationSelect;

type ListRow = Prisma.BlogPostTranslationGetPayload<{
  select: typeof LIST_SELECT;
}>;

function toListItem(row: ListRow): PublicBlogPostListItem {
  const post = row.blogPost;
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? '',
    coverImageUrl: post.coverImageUrl,
    // Always set on published rows; the fallback only guards inconsistent data.
    publishedAt: (row.publishedAt ?? post.createdAt).toISOString(),
    readingMinutes: readingMinutes(row.content),
    author: post.author ? { name: post.author.name } : null,
    technologies: post.technologies.map(({ technology }) => ({
      name: technology.name,
      slug: technology.slug,
    })),
  };
}

/**
 * Neighbours of `slug` in a newest-first list: `previous` is the next older post
 * and `next` the next newer one. No wraparound: null at either end (and both
 * null when `slug` is not in the list).
 */
export function adjacentPosts<T extends BlogPostLink>(
  newestFirst: readonly T[],
  slug: string,
): { previous: BlogPostLink | null; next: BlogPostLink | null } {
  const index = newestFirst.findIndex((item) => item.slug === slug);
  if (index === -1) return { previous: null, next: null };
  const link = (item: T | undefined): BlogPostLink | null =>
    item ? { slug: item.slug, title: item.title } : null;
  return {
    previous: link(newestFirst[index + 1]),
    next: link(newestFirst[index - 1]),
  };
}

/** Read-only public blog endpoints: published content only, per locale. */
@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    publicLocale: PublicLocale,
    page: number,
    limit: number,
  ): Promise<Paginated<PublicBlogPostListItem>> {
    const where = publishedIn(toDbLocale(publicLocale));
    const [rows, total] = await Promise.all([
      this.prisma.blogPostTranslation.findMany({
        where,
        orderBy: PUBLIC_BLOG_ORDER,
        skip: (page - 1) * limit,
        take: limit,
        select: LIST_SELECT,
      }),
      this.prisma.blogPostTranslation.count({ where }),
    ]);
    return { data: rows.map(toListItem), meta: { page, limit, total } };
  }

  async findBySlug(
    publicLocale: PublicLocale,
    slug: string,
  ): Promise<PublicBlogPostDetail> {
    const locale = toDbLocale(publicLocale);
    const row = await this.prisma.blogPostTranslation.findFirst({
      where: { ...publishedIn(locale), slug },
      select: {
        ...LIST_SELECT,
        seoTitle: true,
        seoDescription: true,
        blogPost: {
          select: {
            ...LIST_SELECT.blogPost.select,
            translations: {
              where: { status: 'PUBLISHED' },
              select: { locale: true, slug: true },
            },
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundException(BLOG_POST_NOT_FOUND);
    }

    const ordered = await this.prisma.blogPostTranslation.findMany({
      where: publishedIn(locale),
      orderBy: PUBLIC_BLOG_ORDER,
      select: { slug: true, title: true },
    });
    const alternate = (target: Locale) =>
      row.blogPost.translations.find((t) => t.locale === target)?.slug ?? null;
    const updatedAt =
      row.updatedAt > row.blogPost.updatedAt
        ? row.updatedAt
        : row.blogPost.updatedAt;

    return {
      ...toListItem(row),
      content: row.content,
      updatedAt: updatedAt.toISOString(),
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      alternates: { es: alternate('ES'), en: alternate('EN') },
      ...adjacentPosts(ordered, row.slug),
    };
  }
}
