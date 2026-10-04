import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { RevalidationService } from '../../common/revalidation/revalidation.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  AdminBlogService,
  compareAdminRows,
  missingForBlogPublish,
} from './admin-blog.service.js';
import { BLOG_POST_NOT_FOUND } from './blog.service.js';

const NOW = new Date('2026-10-04T12:00:00Z');

function translation(
  locale: 'ES' | 'EN',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `bt-${locale}`,
    blogPostId: 'post-1',
    locale,
    title: locale === 'ES' ? 'Mi artículo' : 'My post',
    slug: locale === 'ES' ? 'mi-articulo' : 'my-post',
    excerpt: 'Extracto',
    content: '# Hola',
    seoTitle: null,
    seoDescription: null,
    status: 'DRAFT',
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function postRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    authorId: 'user-1',
    coverImageUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    author: { name: 'Wile' },
    translations: [translation('ES'), translation('EN')],
    technologies: [{ technologyId: 'tech-1' }],
    ...overrides,
  };
}

describe('AdminBlogService', () => {
  const prisma = {
    blogPost: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    blogPostTranslation: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    blogPostTechnology: { deleteMany: vi.fn(), createMany: vi.fn() },
    technology: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  const revalidation = { revalidate: vi.fn() };
  let service: AdminBlogService;

  const lastTags = (): string[] => {
    const call = revalidation.revalidate.mock.calls.at(-1) as
      [string[]] | undefined;
    return [...(call?.[0] ?? [])].sort();
  };

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    );
    prisma.blogPost.findFirst.mockResolvedValue(postRow());
    prisma.blogPostTranslation.findUnique.mockResolvedValue(null);
    prisma.blogPostTranslation.count.mockResolvedValue(0);
    revalidation.revalidate.mockResolvedValue(undefined);
    service = new AdminBlogService(
      prisma as unknown as PrismaService,
      revalidation as unknown as RevalidationService,
    );
  });

  describe('create', () => {
    it('creates a draft with a generated slug, authored by the current user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.blogPost.create.mockResolvedValue({ id: 'post-1' });

      const result = await service.create(
        { translations: { ES: { title: 'Sesiones seguras en Next.js' } } },
        'user-1',
      );

      expect(prisma.blogPost.create).toHaveBeenCalledWith({
        data: {
          authorId: 'user-1',
          translations: {
            create: [
              {
                locale: 'ES',
                title: 'Sesiones seguras en Next.js',
                slug: 'sesiones-seguras-en-next-js',
                content: '',
              },
            ],
          },
        },
        select: { id: true },
      });
      expect(result.author).toEqual({ name: 'Wile' });
      expect(revalidation.revalidate).not.toHaveBeenCalled();
    });

    it('stores no author when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.blogPost.create.mockResolvedValue({ id: 'post-1' });
      await service.create(
        { translations: { EN: { title: 'Post' } } },
        'ghost',
      );
      expect(prisma.blogPost.create.mock.calls[0][0].data.authorId).toBeNull();
    });

    it('adds -2 when the generated slug is taken', async () => {
      prisma.blogPostTranslation.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      prisma.blogPost.create.mockResolvedValue({ id: 'post-1' });
      await service.create({ translations: { ES: { title: 'Hola' } } }, 'u');
      expect(
        prisma.blogPost.create.mock.calls[0][0].data.translations.create[0]
          .slug,
      ).toBe('hola-2');
    });

    it('requires at least one locale', async () => {
      await expect(service.create({ translations: {} }, 'u')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns 409 for an explicit slug used by another post', async () => {
      prisma.blogPostTranslation.findUnique.mockResolvedValue({
        blogPostId: 'post-2',
        blogPost: { deletedAt: null },
      });
      await expect(
        service.create(
          { translations: { ES: { title: 'T', slug: 'ocupado' } } },
          'u',
        ),
      ).rejects.toThrow(
        new ConflictException(
          'El slug "ocupado" ya está en uso en otro artículo (ES)',
        ),
      );
    });
  });

  describe('update', () => {
    it('returns 409 for a slug used by another post, deleted or not', async () => {
      prisma.blogPostTranslation.findUnique.mockResolvedValue({
        blogPostId: 'post-2',
        blogPost: { deletedAt: NOW },
      });
      await expect(
        service.update('post-1', { translations: { ES: { slug: 'viejo' } } }),
      ).rejects.toThrow(
        new ConflictException(
          'El slug "viejo" (ES) lo usa un artículo eliminado; elige otro',
        ),
      );
    });

    it('keeps its own slug without a conflict', async () => {
      prisma.blogPostTranslation.findUnique.mockResolvedValue({
        blogPostId: 'post-1',
        blogPost: { deletedAt: null },
      });
      await service.update('post-1', {
        translations: { ES: { slug: 'otro-slug' } },
      });
      expect(prisma.blogPostTranslation.update).toHaveBeenCalled();
    });

    it('does not let a published translation become incomplete (422)', async () => {
      prisma.blogPost.findFirst.mockResolvedValue(
        postRow({ translations: [translation('ES', { status: 'PUBLISHED' })] }),
      );
      const error = await service
        .update('post-1', {
          translations: { ES: { excerpt: null, content: ' ' } },
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(
        (error as UnprocessableEntityException).getResponse(),
      ).toMatchObject({
        message:
          'La versión ES está publicada y no puede quedar incompleta. Falta: extracto, contenido',
        details: { locale: 'ES', missing: ['excerpt', 'content'] },
      });
      expect(prisma.blogPostTranslation.update).not.toHaveBeenCalled();
    });

    it('stores "" as null in nullable fields and replaces technologies in order', async () => {
      prisma.technology.findMany.mockResolvedValue([
        { id: 'tech-2' },
        { id: 'tech-1' },
      ]);
      await service.update('post-1', {
        coverImageUrl: null,
        technologyIds: ['tech-2', 'tech-1'],
        translations: { EN: { excerpt: '', seoTitle: 'SEO', content: 'x' } },
      });

      expect(prisma.blogPostTranslation.update).toHaveBeenCalledWith({
        where: { id: 'bt-EN' },
        data: {
          title: undefined,
          slug: undefined,
          excerpt: null,
          content: 'x',
          seoTitle: 'SEO',
          seoDescription: undefined,
        },
      });
      expect(prisma.blogPost.update).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: { coverImageUrl: null, updatedAt: expect.any(Date) },
      });
      expect(prisma.blogPostTechnology.createMany).toHaveBeenCalledWith({
        data: [
          { blogPostId: 'post-1', technologyId: 'tech-2', sortOrder: 1 },
          { blogPostId: 'post-1', technologyId: 'tech-1', sortOrder: 2 },
        ],
      });
    });

    it('rejects unknown technologies (400)', async () => {
      prisma.technology.findMany.mockResolvedValue([]);
      await expect(
        service.update('post-1', { technologyIds: ['nope'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a missing locale, which requires a title', async () => {
      prisma.blogPost.findFirst.mockResolvedValue(
        postRow({ translations: [translation('ES')] }),
      );
      await expect(
        service.update('post-1', { translations: { EN: { content: 'x' } } }),
      ).rejects.toThrow(BadRequestException);

      await service.update('post-1', {
        translations: { EN: { title: 'New post', content: 'Body' } },
      });
      expect(prisma.blogPostTranslation.create).toHaveBeenCalledWith({
        data: {
          blogPostId: 'post-1',
          locale: 'EN',
          title: 'New post',
          slug: 'new-post',
          excerpt: undefined,
          content: 'Body',
          seoTitle: undefined,
          seoDescription: undefined,
        },
      });
    });

    it('revalidates blog and the old and new slugs', async () => {
      await service.update('post-1', {
        translations: { ES: { slug: 'nuevo-slug' } },
      });
      expect(lastTags()).toEqual([
        'blog',
        'post:mi-articulo',
        'post:my-post',
        'post:nuevo-slug',
      ]);
    });
  });

  describe('publish / unpublish / remove', () => {
    it('publish requires title, slug, excerpt and content (422 in Spanish)', async () => {
      prisma.blogPost.findFirst.mockResolvedValue(
        postRow({
          translations: [translation('EN', { excerpt: null, content: '\n ' })],
        }),
      );
      const error = await service
        .publish('post-1', 'EN')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(
        (error as UnprocessableEntityException).getResponse(),
      ).toMatchObject({
        message:
          'No se puede publicar la versión EN. Falta: extracto, contenido',
        details: { locale: 'EN', missing: ['excerpt', 'content'] },
      });
    });

    it('publishing a missing locale lists every field', async () => {
      prisma.blogPost.findFirst.mockResolvedValue(
        postRow({ translations: [translation('ES')] }),
      );
      const error = (await service
        .publish('post-1', 'EN')
        .catch((e: unknown) => e)) as UnprocessableEntityException;
      expect(error.getResponse()).toMatchObject({
        details: {
          locale: 'EN',
          missing: ['title', 'slug', 'excerpt', 'content'],
        },
      });
    });

    it('sets publishedAt only the first time', async () => {
      await service.publish('post-1', 'ES');
      expect(prisma.blogPostTranslation.update).toHaveBeenCalledWith({
        where: { id: 'bt-ES' },
        data: { status: 'PUBLISHED', publishedAt: expect.any(Date) },
      });

      const first = new Date('2026-09-01T00:00:00Z');
      prisma.blogPost.findFirst.mockResolvedValue(
        postRow({ translations: [translation('ES', { publishedAt: first })] }),
      );
      await service.publish('post-1', 'ES');
      expect(prisma.blogPostTranslation.update).toHaveBeenLastCalledWith({
        where: { id: 'bt-ES' },
        data: { status: 'PUBLISHED', publishedAt: first },
      });
      expect(lastTags()).toEqual(['blog', 'post:mi-articulo']);
    });

    it('unpublish keeps publishedAt; 404 for a missing locale', async () => {
      await service.unpublish('post-1', 'EN');
      expect(prisma.blogPostTranslation.update).toHaveBeenCalledWith({
        where: { id: 'bt-EN' },
        data: { status: 'DRAFT' },
      });
      expect(lastTags()).toEqual(['blog', 'post:mi-articulo', 'post:my-post']);

      prisma.blogPost.findFirst.mockResolvedValue(
        postRow({ translations: [translation('ES')] }),
      );
      await expect(service.unpublish('post-1', 'EN')).rejects.toThrow(
        new NotFoundException('El artículo no tiene versión EN'),
      );
    });

    it('soft-deletes and revalidates; 404 for unknown ids', async () => {
      await service.remove('post-1');
      expect(prisma.blogPost.update).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(lastTags()).toEqual(['blog', 'post:mi-articulo', 'post:my-post']);

      prisma.blogPost.findFirst.mockResolvedValue(null);
      await expect(service.remove('nope')).rejects.toThrow(
        new NotFoundException(BLOG_POST_NOT_FOUND),
      );
    });
  });
});

describe('missingForBlogPublish', () => {
  it('lists the blank required fields', () => {
    expect(
      missingForBlogPublish({
        title: 'T',
        slug: 's',
        excerpt: 'E',
        content: 'C',
      }),
    ).toEqual([]);
    expect(
      missingForBlogPublish({
        title: ' ',
        slug: 's',
        excerpt: null,
        content: '',
      }),
    ).toEqual(['title', 'excerpt', 'content']);
    expect(missingForBlogPublish(null)).toEqual([
      'title',
      'slug',
      'excerpt',
      'content',
    ]);
  });
});

describe('compareAdminRows', () => {
  const item = (
    id: string,
    es: { title: string; publishedAt: Date | null } | null,
    en: { title: string; publishedAt: Date | null } | null = null,
  ) => ({
    id,
    coverImageUrl: null,
    updatedAt: NOW,
    author: null,
    translations: [
      ...(es
        ? [{ locale: 'ES' as const, slug: id, status: 'DRAFT' as const, ...es }]
        : []),
      ...(en
        ? [{ locale: 'EN' as const, slug: id, status: 'DRAFT' as const, ...en }]
        : []),
    ],
  });
  const rows = [
    item('a', { title: 'Zeta', publishedAt: new Date('2026-09-01') }),
    item('b', null, { title: 'Alfa', publishedAt: new Date('2026-09-10') }),
    item('c', { title: 'Ñandú', publishedAt: null }),
  ];
  const ids = (sorted: typeof rows) => sorted.map((r) => r.id);

  it('sorts by ES title falling back to EN, with a Spanish collator', () => {
    expect(ids(rows.toSorted(compareAdminRows('title', 'asc')))).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(ids(rows.toSorted(compareAdminRows('title', 'desc')))).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('sorts by publishedAt with never-published posts last', () => {
    expect(ids(rows.toSorted(compareAdminRows('publishedAt', 'desc')))).toEqual(
      ['b', 'a', 'c'],
    );
    expect(ids(rows.toSorted(compareAdminRows('publishedAt', 'asc')))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
