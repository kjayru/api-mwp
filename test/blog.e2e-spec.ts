import type { NestExpressApplication } from '@nestjs/platform-express';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { loadBlogContent, seedBlogPosts } from '../prisma/blog-content.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { accessToken, bearer } from './utils/auth.js';
import {
  createBlogPost,
  createTechnology,
  createUser,
} from './utils/content.js';
import { createTestApp, truncateAll } from './utils/test-app.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/blog/', import.meta.url));
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const words = (n: number) =>
  Array.from({ length: n }, () => 'palabra').join(' ');

describe('Blog (e2e, real database)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let editor: { Authorization: string };
  let admin: { Authorization: string };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    editor = bearer(accessToken(app, 'EDITOR'));
    admin = bearer(accessToken(app, 'ADMIN'));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    // Ids match the `sub` of the test tokens (test/utils/auth.ts).
    await createUser(prisma, { id: 'user-editor', name: 'Editora' });
    await createUser(prisma, { id: 'user-admin', name: 'Wile', role: 'ADMIN' });
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  describe('GET /api/v1/blog', () => {
    it('lists only published, non-deleted posts of the locale, newest first', async () => {
      const nest = await createTechnology(prisma, {
        name: 'NestJS',
        slug: 'nestjs',
      });
      const gone = await createTechnology(prisma, {
        name: 'Gone',
        slug: 'gone',
        deleted: true,
      });
      await createBlogPost(prisma, {
        authorId: 'user-admin',
        coverImageUrl: 'http://localhost:3001/uploads/2026/10/a.webp',
        technologies: [gone, nest],
        translations: {
          ES: {
            title: 'Viejo',
            slug: 'viejo',
            content: words(450),
            publishedAt: day('2026-09-01'),
          },
          EN: {
            title: 'Old',
            slug: 'old',
            status: 'DRAFT',
          },
        },
      });
      await createBlogPost(prisma, {
        translations: {
          ES: { title: 'Nuevo', slug: 'nuevo', publishedAt: day('2026-09-20') },
          EN: { title: 'New', slug: 'new', publishedAt: day('2026-09-20') },
        },
      });
      await createBlogPost(prisma, {
        translations: {
          ES: { title: 'Borrador', slug: 'borrador', status: 'DRAFT' },
        },
      });
      await createBlogPost(prisma, {
        deleted: true,
        translations: { ES: { title: 'Eliminado', slug: 'eliminado' } },
      });

      const es = await http().get('/api/v1/blog?locale=es').expect(200);
      expect(es.headers['cache-control']).toBe('public, max-age=60');
      expect(es.body.meta).toEqual({ page: 1, limit: 12, total: 2 });
      expect(es.body.data.map((p: { slug: string }) => p.slug)).toEqual([
        'nuevo',
        'viejo',
      ]);
      expect(es.body.data[1]).toEqual({
        slug: 'viejo',
        title: 'Viejo',
        excerpt: 'Extracto de Viejo',
        coverImageUrl: 'http://localhost:3001/uploads/2026/10/a.webp',
        publishedAt: '2026-09-01T00:00:00.000Z',
        readingMinutes: 3,
        author: { name: 'Wile' },
        technologies: [{ name: 'NestJS', slug: 'nestjs' }],
      });
      expect(es.body.data[0].author).toBeNull();
      expect(es.body.data[0]).not.toHaveProperty('content');

      const en = await http().get('/api/v1/blog?locale=en').expect(200);
      expect(en.body.data.map((p: { slug: string }) => p.slug)).toEqual([
        'new',
      ]);
    });

    it('paginates; ties on publishedAt go by the newest post', async () => {
      for (const [i, slug] of ['a', 'b', 'c'].entries()) {
        await createBlogPost(prisma, {
          createdAt: day(`2026-08-0${i + 1}`),
          translations: {
            ES: { title: slug, slug, publishedAt: day('2026-09-10') },
          },
        });
      }
      const page1 = await http()
        .get('/api/v1/blog?locale=es&page=1&limit=2')
        .expect(200);
      expect(page1.body.data.map((p: { slug: string }) => p.slug)).toEqual([
        'c',
        'b',
      ]);
      expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 3 });

      const page2 = await http()
        .get('/api/v1/blog?locale=es&page=2&limit=2')
        .expect(200);
      expect(page2.body.data.map((p: { slug: string }) => p.slug)).toEqual([
        'a',
      ]);

      const page9 = await http()
        .get('/api/v1/blog?locale=es&page=9')
        .expect(200);
      expect(page9.body).toEqual({
        data: [],
        meta: { page: 9, limit: 12, total: 3 },
      });
    });

    it.each([
      ['', 'missing locale'],
      ['?locale=ES', 'uppercase locale'],
      ['?locale=es&limit=51', 'limit above 50'],
      ['?locale=es&page=0', 'page 0'],
      ['?locale=es&status=draft', 'unknown parameter'],
    ])('returns 400 for %s (%s) without Cache-Control', async (query) => {
      const res = await http().get(`/api/v1/blog${query}`).expect(400);
      expect(res.headers['cache-control']).toBeUndefined();
    });
  });

  describe('GET /api/v1/blog/:slug', () => {
    beforeEach(async () => {
      await createBlogPost(prisma, {
        translations: {
          ES: {
            title: 'Primero',
            slug: 'primero',
            publishedAt: day('2026-09-01'),
          },
          EN: { title: 'First', slug: 'first', publishedAt: day('2026-09-01') },
        },
      });
      await createBlogPost(prisma, {
        authorId: 'user-editor',
        translations: {
          ES: {
            title: 'Segundo',
            slug: 'segundo',
            content: '# Segundo\n\n```ts\nconst x = 1;\n```\n\nFin.',
            seoTitle: 'Segundo | Blog',
            seoDescription: 'Descripción',
            publishedAt: day('2026-09-10'),
          },
          EN: { title: 'Second', slug: 'second', status: 'DRAFT' },
        },
      });
      await createBlogPost(prisma, {
        translations: {
          ES: {
            title: 'Tercero',
            slug: 'tercero',
            publishedAt: day('2026-09-20'),
          },
        },
      });
    });

    it('returns the detail with raw Markdown, alternates and neighbours', async () => {
      const res = await http()
        .get('/api/v1/blog/segundo?locale=es')
        .expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.body).toEqual({
        slug: 'segundo',
        title: 'Segundo',
        excerpt: 'Extracto de Segundo',
        coverImageUrl: null,
        publishedAt: '2026-09-10T00:00:00.000Z',
        readingMinutes: 1,
        author: { name: 'Editora' },
        technologies: [],
        content: '# Segundo\n\n```ts\nconst x = 1;\n```\n\nFin.',
        updatedAt: expect.any(String),
        seoTitle: 'Segundo | Blog',
        seoDescription: 'Descripción',
        // EN is a draft.
        alternates: { es: 'segundo', en: null },
        previous: { slug: 'primero', title: 'Primero' },
        next: { slug: 'tercero', title: 'Tercero' },
      });
    });

    it('does not wrap around at either end', async () => {
      const newest = await http()
        .get('/api/v1/blog/tercero?locale=es')
        .expect(200);
      expect(newest.body.next).toBeNull();
      expect(newest.body.previous).toEqual({
        slug: 'segundo',
        title: 'Segundo',
      });

      const oldest = await http()
        .get('/api/v1/blog/primero?locale=es')
        .expect(200);
      expect(oldest.body.previous).toBeNull();
      expect(oldest.body.alternates).toEqual({ es: 'primero', en: 'first' });

      // Only one EN post is published.
      const en = await http().get('/api/v1/blog/first?locale=en').expect(200);
      expect([en.body.previous, en.body.next]).toEqual([null, null]);
    });

    it('returns 404 for unknown, draft or other-locale slugs', async () => {
      for (const url of [
        '/api/v1/blog/nope?locale=es',
        '/api/v1/blog/second?locale=en',
        '/api/v1/blog/first?locale=es',
      ]) {
        const res = await http().get(url).expect(404);
        expect(res.body.message).toBe('Artículo no encontrado');
        expect(res.headers['cache-control']).toBeUndefined();
      }
      await http().get('/api/v1/blog/segundo').expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  describe('admin auth', () => {
    it.each([
      ['GET', '/api/v1/admin/blog'],
      ['GET', '/api/v1/admin/blog/x'],
      ['POST', '/api/v1/admin/blog'],
      ['PATCH', '/api/v1/admin/blog/x'],
      ['POST', '/api/v1/admin/blog/x/publish'],
      ['POST', '/api/v1/admin/blog/x/unpublish'],
      ['DELETE', '/api/v1/admin/blog/x'],
    ])('%s %s returns 401 without a token', async (method, url) => {
      await http()[method.toLowerCase() as 'get'](url).expect(401);
    });

    it('allows EDITOR and ADMIN', async () => {
      await http().get('/api/v1/admin/blog').set(editor).expect(200);
      await http().get('/api/v1/admin/blog').set(admin).expect(200);
    });
  });

  it('full lifecycle: create → patch → publish → public → slug change → unpublish → delete', async () => {
    const nest = await createTechnology(prisma, {
      name: 'NestJS',
      slug: 'nestjs',
    });
    const prismaTech = await createTechnology(prisma, {
      name: 'Prisma',
      slug: 'prisma',
    });

    // Create: minimal body, slug generated, author = current user, DRAFT.
    const created = await http()
      .post('/api/v1/admin/blog')
      .set(editor)
      .send({ translations: { ES: { title: 'NestJS 12 + Prisma 7 con ESM' } } })
      .expect(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      coverImageUrl: null,
      technologyIds: [],
      author: { name: 'Editora' },
      translations: {
        ES: {
          title: 'NestJS 12 + Prisma 7 con ESM',
          slug: 'nestjs-12-prisma-7-con-esm',
          excerpt: null,
          content: '',
          seoTitle: null,
          seoDescription: null,
          status: 'DRAFT',
          publishedAt: null,
        },
        EN: null,
      },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const id: string = created.body.id;
    const slug = 'nestjs-12-prisma-7-con-esm';

    // Publishing now fails: no excerpt and no content.
    const incomplete = await http()
      .post(`/api/v1/admin/blog/${id}/publish`)
      .set(editor)
      .send({ locale: 'ES' })
      .expect(422);
    expect(incomplete.body).toMatchObject({
      message: 'No se puede publicar la versión ES. Falta: extracto, contenido',
      details: { locale: 'ES', missing: ['excerpt', 'content'] },
    });

    // Patch: content, cover, technologies (ordered) and a new EN locale.
    const patched = await http()
      .patch(`/api/v1/admin/blog/${id}`)
      .set(admin)
      .send({
        coverImageUrl: 'http://localhost:3001/uploads/2026/10/cover.webp',
        technologyIds: [prismaTech, nest],
        translations: {
          ES: {
            excerpt: 'Cómo arrancamos una API.',
            content: `# Intro\n\n${words(250)}`,
            seoDescription: 'NestJS 12 y Prisma 7 con ESM.',
          },
          EN: { title: 'NestJS 12 + Prisma 7 with ESM' },
        },
      })
      .expect(200);
    expect(patched.body.technologyIds).toEqual([prismaTech, nest]);
    expect(patched.body.coverImageUrl).toBe(
      'http://localhost:3001/uploads/2026/10/cover.webp',
    );
    expect(patched.body.translations.EN).toMatchObject({
      slug: 'nestjs-12-prisma-7-with-esm',
      status: 'DRAFT',
      content: '',
    });

    // Not public yet.
    await http().get(`/api/v1/blog/${slug}?locale=es`).expect(404);

    const published = await http()
      .post(`/api/v1/admin/blog/${id}/publish`)
      .set(editor)
      .send({ locale: 'es' })
      .expect(200);
    const firstPublishedAt = published.body.translations.ES.publishedAt;
    expect(published.body.translations.ES.status).toBe('PUBLISHED');
    expect(firstPublishedAt).toEqual(expect.any(String));

    const detail = await http()
      .get(`/api/v1/blog/${slug}?locale=es`)
      .expect(200);
    expect(detail.body).toMatchObject({
      title: 'NestJS 12 + Prisma 7 con ESM',
      readingMinutes: 2,
      author: { name: 'Editora' },
      technologies: [
        { name: 'Prisma', slug: 'prisma' },
        { name: 'NestJS', slug: 'nestjs' },
      ],
      alternates: { es: slug, en: null },
    });
    const list = await http().get('/api/v1/blog?locale=es').expect(200);
    expect(list.body.meta.total).toBe(1);
    await http()
      .get('/api/v1/blog?locale=en')
      .expect(200, {
        data: [],
        meta: { page: 1, limit: 12, total: 0 },
      });

    // A published translation cannot be emptied (422, nothing saved).
    const keep = await http()
      .patch(`/api/v1/admin/blog/${id}`)
      .set(editor)
      .send({ translations: { ES: { content: '   ', title: 'Otro título' } } })
      .expect(422);
    expect(keep.body).toMatchObject({
      message:
        'La versión ES está publicada y no puede quedar incompleta. Falta: contenido',
      details: { locale: 'ES', missing: ['content'] },
    });
    const unchanged = await http()
      .get(`/api/v1/admin/blog/${id}`)
      .set(editor)
      .expect(200);
    expect(unchanged.body.translations.ES.title).toBe(
      'NestJS 12 + Prisma 7 con ESM',
    );

    // Slug change: the old slug 404s, the new one works.
    await http()
      .patch(`/api/v1/admin/blog/${id}`)
      .set(editor)
      .send({ translations: { ES: { slug: 'nestjs-prisma-esm' } } })
      .expect(200);
    await http().get(`/api/v1/blog/${slug}?locale=es`).expect(404);
    await http().get('/api/v1/blog/nestjs-prisma-esm?locale=es').expect(200);

    // Republishing keeps the first publishedAt.
    const again = await http()
      .post(`/api/v1/admin/blog/${id}/publish`)
      .set(editor)
      .send({ locale: 'ES' })
      .expect(200);
    expect(again.body.translations.ES.publishedAt).toBe(firstPublishedAt);

    // Unpublish: 404 publicly, publishedAt kept.
    const unpublished = await http()
      .post(`/api/v1/admin/blog/${id}/unpublish`)
      .set(editor)
      .send({ locale: 'ES' })
      .expect(200);
    expect(unpublished.body.translations.ES).toMatchObject({
      status: 'DRAFT',
      publishedAt: firstPublishedAt,
    });
    await http().get('/api/v1/blog/nestjs-prisma-esm?locale=es').expect(404);

    // Delete (soft): 204, then 404 everywhere; the slug stays reserved.
    await http().delete(`/api/v1/admin/blog/${id}`).set(editor).expect(204);
    await http().get(`/api/v1/admin/blog/${id}`).set(editor).expect(404);
    await http().delete(`/api/v1/admin/blog/${id}`).set(editor).expect(404);
    const listed = await http()
      .get('/api/v1/admin/blog')
      .set(editor)
      .expect(200);
    expect(listed.body.meta.total).toBe(0);
    const reused = await http()
      .post('/api/v1/admin/blog')
      .set(editor)
      .send({ translations: { ES: { title: 'X', slug: 'nestjs-prisma-esm' } } })
      .expect(409);
    expect(reused.body.message).toBe(
      'El slug "nestjs-prisma-esm" (ES) lo usa un artículo eliminado; elige otro',
    );
  });

  describe('validation and conflicts', () => {
    let id: string;

    beforeEach(async () => {
      await createBlogPost(prisma, {
        translations: {
          ES: { title: 'Ocupado', slug: 'ocupado' },
          EN: { title: 'Taken', slug: 'taken' },
        },
      });
      id = await createBlogPost(prisma, {
        translations: { ES: { title: 'Mío', slug: 'mio', status: 'DRAFT' } },
      });
    });

    it('returns 409 for slugs in use and 200 for its own slug', async () => {
      const post = await http()
        .post('/api/v1/admin/blog')
        .set(editor)
        .send({ translations: { EN: { title: 'T', slug: 'taken' } } })
        .expect(409);
      expect(post.body.message).toBe(
        'El slug "taken" ya está en uso en otro artículo (EN)',
      );
      await http()
        .patch(`/api/v1/admin/blog/${id}`)
        .set(editor)
        .send({ translations: { ES: { slug: 'ocupado' } } })
        .expect(409);
      await http()
        .patch(`/api/v1/admin/blog/${id}`)
        .set(editor)
        .send({ translations: { ES: { slug: 'mio' } } })
        .expect(200);
    });

    it('generates a unique slug when the title slug is taken', async () => {
      const res = await http()
        .post('/api/v1/admin/blog')
        .set(editor)
        .send({ translations: { ES: { title: 'Ocupado' } } })
        .expect(201);
      expect(res.body.translations.ES.slug).toBe('ocupado-2');
    });

    it.each([
      [{ translations: {} }, 'no locale'],
      [{ translations: { ES: { title: '' } } }, 'empty title'],
      [{ translations: { ES: { title: 'T', slug: 'Mal Slug' } } }, 'bad slug'],
      [
        { translations: { ES: { title: 'T' } }, technologyIds: [] },
        'unknown field',
      ],
      [{}, 'no translations'],
    ] as [object, string][])('POST returns 400 for %j (%s)', async (body) => {
      await http()
        .post('/api/v1/admin/blog')
        .set(editor)
        .send(body)
        .expect(400);
    });

    it.each([
      [{ coverImageUrl: 'ftp://x/y.png' }, 'non-http cover'],
      [{ technologyIds: ['nope'] }, 'unknown technology'],
      [{ technologyIds: 'x' }, 'technologyIds not an array'],
      [
        { translations: { ES: { seoDescription: 'x'.repeat(161) } } },
        'long SEO',
      ],
      [
        { translations: { ES: { content: 'x'.repeat(100_001) } } },
        'long content',
      ],
      [{ translations: { ES: { title: null } } }, 'null title'],
      [{ translations: { EN: { content: 'x' } } }, 'new locale without title'],
      [{ status: 'PUBLISHED' }, 'unknown field'],
    ] as [object, string][])('PATCH returns 400 (case %#)', async (body) => {
      await http()
        .patch(`/api/v1/admin/blog/${id}`)
        .set(editor)
        .send(body)
        .expect(400);
    });

    it('accepts 100 000 characters of multi-byte Markdown (body over 100 kB)', async () => {
      const content = 'ñ'.repeat(100_000);
      const res = await http()
        .patch(`/api/v1/admin/blog/${id}`)
        .set(editor)
        .send({ translations: { ES: { content } } })
        .expect(200);
      expect(res.body.translations.ES.content).toHaveLength(100_000);
    });

    it('returns 413 in the common error format for a JSON body above 1 MB', async () => {
      const res = await http()
        .patch(`/api/v1/admin/blog/${id}`)
        .set(editor)
        .send({ translations: { ES: { content: 'x'.repeat(1_100_000) } } })
        .expect(413);
      expect(res.body).toMatchObject({
        statusCode: 413,
        error: 'Payload Too Large',
        message: 'El cuerpo de la petición es demasiado grande',
        path: `/api/v1/admin/blog/${id}`,
      });
    });

    it('PATCH accepts null or "" to clear nullable fields', async () => {
      await http()
        .patch(`/api/v1/admin/blog/${id}`)
        .set(editor)
        .send({
          coverImageUrl: 'http://localhost:3001/uploads/a.png',
          translations: {
            ES: { excerpt: 'E', seoTitle: 'S', seoDescription: 'D' },
          },
        })
        .expect(200);
      const res = await http()
        .patch(`/api/v1/admin/blog/${id}`)
        .set(editor)
        .send({
          coverImageUrl: null,
          translations: {
            ES: { excerpt: '', seoTitle: null, seoDescription: '' },
          },
        })
        .expect(200);
      expect(res.body.coverImageUrl).toBeNull();
      expect(res.body.translations.ES).toMatchObject({
        excerpt: null,
        seoTitle: null,
        seoDescription: null,
      });
    });

    it('publish: 400 for an invalid locale, 422 for a missing one, 404 to unpublish it', async () => {
      await http()
        .post(`/api/v1/admin/blog/${id}/publish`)
        .set(editor)
        .send({ locale: 'FR' })
        .expect(400);
      const missing = await http()
        .post(`/api/v1/admin/blog/${id}/publish`)
        .set(editor)
        .send({ locale: 'EN' })
        .expect(422);
      expect(missing.body.details).toEqual({
        locale: 'EN',
        missing: ['title', 'slug', 'excerpt', 'content'],
      });
      const unpublish = await http()
        .post(`/api/v1/admin/blog/${id}/unpublish`)
        .set(editor)
        .send({ locale: 'EN' })
        .expect(404);
      expect(unpublish.body.message).toBe('El artículo no tiene versión EN');
      await http()
        .post('/api/v1/admin/blog/nope/publish')
        .set(editor)
        .send({ locale: 'ES' })
        .expect(404);
    });
  });

  describe('GET /api/v1/admin/blog (list)', () => {
    beforeEach(async () => {
      await createBlogPost(prisma, {
        authorId: 'user-admin',
        translations: {
          ES: { title: 'Zeta', slug: 'zeta', publishedAt: day('2026-09-01') },
          EN: { title: 'Zeta EN', slug: 'zeta-en', status: 'DRAFT' },
        },
      });
      await createBlogPost(prisma, {
        translations: {
          EN: { title: 'Alfa', slug: 'alfa', publishedAt: day('2026-09-10') },
        },
      });
      await createBlogPost(prisma, {
        translations: {
          ES: { title: 'Ñandú', slug: 'nandu', status: 'DRAFT' },
        },
      });
      await createBlogPost(prisma, {
        deleted: true,
        translations: { ES: { title: 'Borrado', slug: 'borrado' } },
      });
    });

    const titles = (body: {
      data: { translations: Record<string, { title: string } | null> }[];
    }) => body.data.map((p) => (p.translations.ES ?? p.translations.EN)!.title);

    it('lists non-deleted posts with per-locale summaries, newest update first', async () => {
      const res = await http()
        .get('/api/v1/admin/blog')
        .set(editor)
        .expect(200);
      expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 3 });
      expect(titles(res.body)).toEqual(['Ñandú', 'Alfa', 'Zeta']);
      const zeta = res.body.data[2];
      expect(zeta).toEqual({
        id: expect.any(String),
        coverImageUrl: null,
        updatedAt: expect.any(String),
        author: { name: 'Wile' },
        translations: {
          ES: {
            title: 'Zeta',
            slug: 'zeta',
            status: 'PUBLISHED',
            publishedAt: '2026-09-01T00:00:00.000Z',
          },
          EN: {
            title: 'Zeta EN',
            slug: 'zeta-en',
            status: 'DRAFT',
            publishedAt: null,
          },
        },
      });
      expect(res.headers['cache-control']).toBeUndefined();
    });

    it('searches, filters by status, sorts and paginates', async () => {
      const q = await http()
        .get('/api/v1/admin/blog?q=ZETA')
        .set(editor)
        .expect(200);
      expect(titles(q.body)).toEqual(['Zeta']);

      const drafts = await http()
        .get('/api/v1/admin/blog?status=draft&sort=title')
        .set(editor)
        .expect(200);
      expect(titles(drafts.body)).toEqual(['Ñandú', 'Zeta']);

      const byTitle = await http()
        .get('/api/v1/admin/blog?sort=title&order=desc&limit=2')
        .set(editor)
        .expect(200);
      expect(titles(byTitle.body)).toEqual(['Zeta', 'Ñandú']);
      expect(byTitle.body.meta).toEqual({ page: 1, limit: 2, total: 3 });

      const byDate = await http()
        .get('/api/v1/admin/blog?sort=publishedAt')
        .set(editor)
        .expect(200);
      expect(titles(byDate.body)).toEqual(['Alfa', 'Zeta', 'Ñandú']);

      await http()
        .get('/api/v1/admin/blog?sort=sortOrder')
        .set(editor)
        .expect(400);
      await http().get('/api/v1/admin/blog?status=x').set(editor).expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Seed
  // ---------------------------------------------------------------------------

  it('seeds the fixture posts once (create-only) and serves them publicly', async () => {
    const techIds = new Map<string, string>();
    for (const [name, slug] of [
      ['NestJS', 'nestjs'],
      ['Prisma', 'prisma'],
      ['Next.js', 'nextjs'],
    ]) {
      techIds.set(slug, await createTechnology(prisma, { name, slug }));
    }
    const content = loadBlogContent(FIXTURES, new Set(techIds.keys()));
    expect(content?.posts).toHaveLength(2);

    expect(
      await seedBlogPosts(prisma, content!.posts, 'user-admin', techIds),
    ).toEqual({ created: 2, kept: 0 });
    expect(
      await seedBlogPosts(prisma, content!.posts, 'user-admin', techIds),
    ).toEqual({ created: 0, kept: 2 });

    const en = await http().get('/api/v1/blog?locale=en').expect(200);
    expect(en.body.data.map((p: { slug: string }) => p.slug)).toEqual([
      'second-post',
      'first-post',
    ]);
    expect(en.body.data[1]).toMatchObject({
      publishedAt: '2026-09-01T00:00:00.000Z',
      author: { name: 'Wile' },
      technologies: [
        { name: 'NestJS', slug: 'nestjs' },
        { name: 'Prisma', slug: 'prisma' },
      ],
    });

    const detail = await http()
      .get('/api/v1/blog/segundo-articulo?locale=es')
      .expect(200);
    expect(detail.body).toMatchObject({
      seoTitle: 'Segundo artículo | Blog de prueba',
      alternates: { es: 'segundo-articulo', en: 'second-post' },
      previous: { slug: 'primer-articulo', title: 'Primer artículo de prueba' },
      next: null,
      readingMinutes: 1,
    });
    expect(detail.body.content).toContain(
      '```ts\nexport const answer = 42;\n```',
    );

    // An edited post is kept as it is.
    await prisma.blogPostTranslation.updateMany({
      where: { slug: 'primer-articulo' },
      data: { title: 'Editado en el admin' },
    });
    await seedBlogPosts(prisma, content!.posts, 'user-admin', techIds);
    const kept = await prisma.blogPostTranslation.findFirst({
      where: { slug: 'primer-articulo' },
    });
    expect(kept?.title).toBe('Editado en el admin');
  });
});
