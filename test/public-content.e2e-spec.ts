import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createCase,
  createService,
  createTechnology,
} from './utils/content.js';
import { createTestApp, truncateAll } from './utils/test-app.js';

/**
 * Public endpoints against a fixed data set:
 * - caso-a: ES+EN published, chips React, (deleted Old), NestJS; gallery + empty blocks.
 * - caso-b: ES published, EN draft, anonymised client.
 * - caso-c: ES draft only. caso-d: published but soft-deleted.
 * - case-e: EN published, ES draft.
 */
describe('Public content (e2e, real database)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await truncateAll(prisma);

    const nest = await createTechnology(prisma, {
      name: 'NestJS',
      slug: 'nestjs',
      sortOrder: 1,
      isFeatured: true,
      descriptions: { ES: 'Framework de Node', EN: 'Node framework' },
    });
    const react = await createTechnology(prisma, {
      name: 'React',
      slug: 'react',
      sortOrder: 2,
    });
    const old = await createTechnology(prisma, {
      name: 'Old',
      slug: 'old',
      sortOrder: 0,
      isFeatured: true,
      deleted: true,
    });

    await createCase(prisma, {
      type: 'SAAS',
      sortOrder: 1,
      client: 'Cliente A',
      technologies: [react, old, nest],
      images: [
        {
          id: 'img-a1',
          url: 'https://cdn.test/a1.png',
          alt: { ES: 'Panel', EN: 'Dashboard' },
        },
      ],
      translations: {
        ES: {
          title: 'Caso A',
          slug: 'caso-a',
          tagline: 'SaaS · Salud',
          industry: 'Salud',
          blocks: [
            { type: 'text', title: 'El reto', body: 'Texto' },
            { type: 'gallery', imageIds: ['img-a1'], caption: 'Capturas' },
            { type: 'gallery', imageIds: [] },
            { type: 'metrics', items: [] },
            { type: 'metrics', items: [{ value: '35%', label: 'menos' }] },
          ],
        },
        EN: { title: 'Case A', slug: 'case-a', industry: 'Health' },
      },
    });
    await createCase(prisma, {
      type: 'TOOL',
      sortOrder: 2,
      client: 'Secreto SA',
      anonymizeClient: true,
      technologies: [nest],
      translations: {
        ES: { title: 'Caso B', slug: 'caso-b', industry: 'Retail' },
        EN: { title: 'Case B', slug: 'case-b', status: 'DRAFT' },
      },
    });
    await createCase(prisma, {
      type: 'ECOMMERCE',
      sortOrder: 3,
      technologies: [react],
      translations: {
        ES: {
          title: 'Caso C',
          slug: 'caso-c',
          status: 'DRAFT',
          industry: 'Moda',
        },
      },
    });
    await createCase(prisma, {
      sortOrder: 0,
      deleted: true,
      translations: {
        ES: { title: 'Caso D', slug: 'caso-d', industry: 'Minería' },
      },
    });
    await createCase(prisma, {
      type: 'PLATFORM',
      sortOrder: 4,
      translations: {
        ES: {
          title: 'Caso E',
          slug: 'caso-e',
          status: 'DRAFT',
          industry: 'Logística',
        },
        EN: { title: 'Case E', slug: 'case-e' },
      },
    });

    await createService(prisma, {
      sortOrder: 2,
      technologies: [old, nest],
      translations: {
        ES: { title: 'Webs con CMS', slug: 'webs-con-cms' },
        EN: { title: 'Websites', slug: 'websites', status: 'DRAFT' },
      },
    });
    await createService(prisma, {
      sortOrder: 1,
      translations: {
        ES: { title: 'APIs', slug: 'apis' },
        EN: { title: 'APIs', slug: 'apis' },
      },
    });
    await createService(prisma, {
      sortOrder: 0,
      deleted: true,
      translations: { ES: { title: 'Borrado', slug: 'borrado' } },
    });
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  describe('GET /api/v1/cases', () => {
    it('lists only the published, non-deleted cases of the locale, in order', async () => {
      const es = await http().get('/api/v1/cases?locale=es').expect(200);
      expect(es.body.data.map((c: { slug: string }) => c.slug)).toEqual([
        'caso-a',
        'caso-b',
      ]);

      const en = await http().get('/api/v1/cases?locale=en').expect(200);
      expect(en.body.data.map((c: { slug: string }) => c.slug)).toEqual([
        'case-a',
        'case-e',
      ]);
    });

    it('returns the list shape with chips in order and without deleted technologies', async () => {
      const res = await http().get('/api/v1/cases?locale=es').expect(200);

      expect(res.body.data[0]).toEqual({
        slug: 'caso-a',
        title: 'Caso A',
        tagline: 'SaaS · Salud',
        summary: 'Resumen de Caso A',
        type: 'SAAS',
        industry: 'Salud',
        year: null,
        coverImageUrl: null,
        technologies: [
          { name: 'React', slug: 'react' },
          { name: 'NestJS', slug: 'nestjs' },
        ],
      });
      // The list never exposes ids or the client.
      expect(JSON.stringify(res.body)).not.toMatch(/"id"|Secreto|client/);
    });

    it('filters by type', async () => {
      const res = await http()
        .get('/api/v1/cases?locale=es&type=TOOL')
        .expect(200);
      expect(res.body.data.map((c: { slug: string }) => c.slug)).toEqual([
        'caso-b',
      ]);
    });

    it('sends Cache-Control on success only', async () => {
      const ok = await http().get('/api/v1/cases?locale=es').expect(200);
      expect(ok.headers['cache-control']).toBe('public, max-age=60');

      const bad = await http().get('/api/v1/cases?locale=fr').expect(400);
      expect(bad.headers['cache-control']).toBeUndefined();
    });

    it.each([
      ['a missing locale', '/api/v1/cases'],
      ['an invalid locale', '/api/v1/cases?locale=fr'],
      ['an uppercase locale', '/api/v1/cases?locale=ES'],
      ['an invalid type', '/api/v1/cases?locale=es&type=BLOG'],
      ['an unknown parameter', '/api/v1/cases?locale=es&page=2'],
    ])('returns 400 for %s', async (_, url) => {
      const res = await http().get(url).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    });
  });

  describe('GET /api/v1/cases/:slug', () => {
    it('returns the detail with resolved blocks, alternates and next case', async () => {
      const res = await http()
        .get('/api/v1/cases/caso-a?locale=es')
        .expect(200);

      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.body).toMatchObject({
        slug: 'caso-a',
        title: 'Caso A',
        client: 'Cliente A',
        type: 'SAAS',
        technologies: [
          { name: 'React', slug: 'react' },
          { name: 'NestJS', slug: 'nestjs' },
        ],
        seoTitle: null,
        seoDescription: null,
        publishedAt: expect.any(String),
        alternates: { es: 'caso-a', en: 'case-a' },
        next: { slug: 'caso-b', title: 'Caso B' },
      });
      expect(res.body.blocks).toEqual([
        { type: 'text', title: 'El reto', body: 'Texto' },
        {
          type: 'gallery',
          images: [{ url: 'https://cdn.test/a1.png', alt: 'Panel' }],
          caption: 'Capturas',
        },
        {
          type: 'metrics',
          title: null,
          items: [{ value: '35%', label: 'menos' }],
        },
      ]);
    });

    it('hides an anonymised client and wraps "next" around', async () => {
      const res = await http()
        .get('/api/v1/cases/caso-b?locale=es')
        .expect(200);

      expect(res.body.client).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('Secreto');
      expect(res.body.alternates).toEqual({ es: 'caso-b', en: null });
      expect(res.body.next).toEqual({ slug: 'caso-a', title: 'Caso A' });
    });

    it.each([
      ['a draft locale', '/api/v1/cases/case-b?locale=en'],
      ['a draft-only case', '/api/v1/cases/caso-c?locale=es'],
      ['a deleted case', '/api/v1/cases/caso-d?locale=es'],
      ['a slug of the other locale', '/api/v1/cases/caso-a?locale=en'],
      ['an unknown slug', '/api/v1/cases/nope?locale=es'],
    ])('returns 404 for %s', async (_, url) => {
      const res = await http().get(url).expect(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        message: 'Caso no encontrado',
      });
      expect(res.headers['cache-control']).toBeUndefined();
    });
  });

  describe('GET /api/v1/technologies', () => {
    it('lists the non-deleted technologies with the description of the locale', async () => {
      const res = await http()
        .get('/api/v1/technologies?locale=en')
        .expect(200);

      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.body.data).toEqual([
        {
          name: 'NestJS',
          slug: 'nestjs',
          category: 'OTHER',
          isFeatured: true,
          description: 'Node framework',
        },
        {
          name: 'React',
          slug: 'react',
          category: 'OTHER',
          isFeatured: false,
          description: null,
        },
      ]);
    });

    it('filters featured technologies', async () => {
      const res = await http()
        .get('/api/v1/technologies?locale=es&featured=true')
        .expect(200);
      expect(res.body.data.map((t: { slug: string }) => t.slug)).toEqual([
        'nestjs',
      ]);
      await http()
        .get('/api/v1/technologies?locale=es&featured=yes')
        .expect(400);
    });
  });

  describe('GET /api/v1/services', () => {
    it('lists the published services of the locale in order with their chips', async () => {
      const es = await http().get('/api/v1/services?locale=es').expect(200);

      expect(es.headers['cache-control']).toBe('public, max-age=60');
      expect(es.body.data).toEqual([
        {
          title: 'APIs',
          slug: 'apis',
          description: 'Descripción de APIs',
          technologies: [],
        },
        {
          title: 'Webs con CMS',
          slug: 'webs-con-cms',
          description: 'Descripción de Webs con CMS',
          technologies: [{ name: 'NestJS', slug: 'nestjs' }],
        },
      ]);

      const en = await http().get('/api/v1/services?locale=en').expect(200);
      expect(en.body.data.map((s: { slug: string }) => s.slug)).toEqual([
        'apis',
      ]);
    });

    it('requires the locale', async () => {
      await http().get('/api/v1/services').expect(400);
    });
  });

  describe('GET /api/v1/stats', () => {
    it('counts published cases, their technologies and ES industries', async () => {
      const res = await http().get('/api/v1/stats').expect(200);

      expect(res.headers['cache-control']).toBe('public, max-age=60');
      // caso-a, caso-b and case-e; technologies NestJS and React (Old is
      // deleted); industries Salud, Retail and Logística (from the ES draft).
      expect(res.body).toEqual({ projects: 3, technologies: 2, industries: 3 });
    });
  });
});
