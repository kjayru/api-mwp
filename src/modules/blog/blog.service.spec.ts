import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  adjacentPosts,
  BLOG_POST_NOT_FOUND,
  BlogService,
  PUBLIC_BLOG_ORDER,
} from './blog.service.js';

const PUBLISHED = new Date('2026-09-12T00:00:00Z');
const CREATED = new Date('2026-09-01T10:00:00Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'mi-post',
    title: 'Mi post',
    excerpt: 'Extracto',
    content: 'uno dos tres',
    publishedAt: PUBLISHED,
    updatedAt: new Date('2026-09-20T00:00:00Z'),
    seoTitle: null,
    seoDescription: 'SEO',
    blogPost: {
      coverImageUrl: null,
      createdAt: CREATED,
      updatedAt: new Date('2026-09-25T00:00:00Z'),
      author: { name: 'Wile' },
      technologies: [
        { technology: { name: 'NestJS', slug: 'nestjs' } },
        { technology: { name: 'Prisma', slug: 'prisma' } },
      ],
      translations: [
        { locale: 'ES', slug: 'mi-post' },
        { locale: 'EN', slug: 'my-post' },
      ],
    },
    ...overrides,
  };
}

describe('adjacentPosts', () => {
  const newestFirst = [
    { slug: 'c', title: 'C (newest)' },
    { slug: 'b', title: 'B' },
    { slug: 'a', title: 'A (oldest)' },
  ];

  it('previous is the next older post and next the next newer one', () => {
    expect(adjacentPosts(newestFirst, 'b')).toEqual({
      previous: { slug: 'a', title: 'A (oldest)' },
      next: { slug: 'c', title: 'C (newest)' },
    });
  });

  it('does not wrap around', () => {
    expect(adjacentPosts(newestFirst, 'c')).toEqual({
      previous: { slug: 'b', title: 'B' },
      next: null,
    });
    expect(adjacentPosts(newestFirst, 'a')).toEqual({
      previous: null,
      next: { slug: 'b', title: 'B' },
    });
  });

  it('returns nulls for a single post or an unknown slug', () => {
    expect(adjacentPosts([{ slug: 'a', title: 'A' }], 'a')).toEqual({
      previous: null,
      next: null,
    });
    expect(adjacentPosts(newestFirst, 'zzz')).toEqual({
      previous: null,
      next: null,
    });
  });
});

describe('BlogService', () => {
  const prisma = {
    blogPostTranslation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  };
  let service: BlogService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new BlogService(prisma as unknown as PrismaService);
  });

  it('lists published posts of the locale, paginated, newest first', async () => {
    prisma.blogPostTranslation.findMany.mockResolvedValue([row()]);
    prisma.blogPostTranslation.count.mockResolvedValue(13);

    const result = await service.list('es', 2, 12);

    expect(prisma.blogPostTranslation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          locale: 'ES',
          status: 'PUBLISHED',
          blogPost: { deletedAt: null },
        },
        orderBy: PUBLIC_BLOG_ORDER,
        skip: 12,
        take: 12,
      }),
    );
    expect(result).toEqual({
      data: [
        {
          slug: 'mi-post',
          title: 'Mi post',
          excerpt: 'Extracto',
          coverImageUrl: null,
          publishedAt: '2026-09-12T00:00:00.000Z',
          readingMinutes: 1,
          author: { name: 'Wile' },
          technologies: [
            { name: 'NestJS', slug: 'nestjs' },
            { name: 'Prisma', slug: 'prisma' },
          ],
        },
      ],
      meta: { page: 2, limit: 12, total: 13 },
    });
  });

  it('orders by publishedAt desc, then the post createdAt desc', () => {
    expect(PUBLIC_BLOG_ORDER).toEqual([
      { publishedAt: { sort: 'desc', nulls: 'last' } },
      { blogPost: { createdAt: 'desc' } },
      { blogPostId: 'desc' },
    ]);
  });

  it('returns the detail with content, alternates and neighbours', async () => {
    prisma.blogPostTranslation.findFirst.mockResolvedValue(
      row({
        content: Array.from({ length: 401 }, () => 'w').join(' '),
        blogPost: { ...row().blogPost, author: null },
      }),
    );
    prisma.blogPostTranslation.findMany.mockResolvedValue([
      { slug: 'newer', title: 'Newer' },
      { slug: 'mi-post', title: 'Mi post' },
    ]);

    const detail = await service.findBySlug('es', 'mi-post');

    expect(prisma.blogPostTranslation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          locale: 'ES',
          status: 'PUBLISHED',
          blogPost: { deletedAt: null },
          slug: 'mi-post',
        },
      }),
    );
    expect(detail).toMatchObject({
      slug: 'mi-post',
      readingMinutes: 3,
      author: null,
      seoTitle: null,
      seoDescription: 'SEO',
      // The later of the translation and the post updatedAt.
      updatedAt: '2026-09-25T00:00:00.000Z',
      alternates: { es: 'mi-post', en: 'my-post' },
      previous: null,
      next: { slug: 'newer', title: 'Newer' },
    });
    expect(detail.content).toHaveLength(801);
  });

  it('alternates are null for locales that are not published', async () => {
    prisma.blogPostTranslation.findFirst.mockResolvedValue(
      row({
        blogPost: {
          ...row().blogPost,
          translations: [{ locale: 'EN', slug: 'my-post' }],
        },
      }),
    );
    prisma.blogPostTranslation.findMany.mockResolvedValue([]);
    const detail = await service.findBySlug('en', 'my-post');
    expect(detail.alternates).toEqual({ es: null, en: 'my-post' });
  });

  it('404 for an unknown or unpublished slug', async () => {
    prisma.blogPostTranslation.findFirst.mockResolvedValue(null);
    await expect(service.findBySlug('es', 'nope')).rejects.toThrow(
      new NotFoundException(BLOG_POST_NOT_FOUND),
    );
  });
});
