import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { accessToken, bearer } from './utils/auth.js';
import { createCase, createTechnology } from './utils/content.js';
import { createTestApp, truncateAll } from './utils/test-app.js';

describe('Admin cases (e2e, real database)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: { Authorization: string };
  let editor: { Authorization: string };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = bearer(accessToken(app, 'ADMIN'));
    editor = bearer(accessToken(app, 'EDITOR'));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  describe('auth', () => {
    it.each([
      ['GET', '/api/v1/admin/cases'],
      ['GET', '/api/v1/admin/cases/any'],
      ['POST', '/api/v1/admin/cases'],
      ['PATCH', '/api/v1/admin/cases/any'],
      ['POST', '/api/v1/admin/cases/any/publish'],
      ['DELETE', '/api/v1/admin/cases/any'],
      ['PUT', '/api/v1/admin/cases/order'],
      ['POST', '/api/v1/admin/cases/any/images'],
    ])('%s %s returns 401 without a token', async (method, url) => {
      const res = await http()
        [method.toLowerCase() as 'get'](url)
        .send({})
        .expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, path: url });
    });

    it('allows EDITOR as well as ADMIN', async () => {
      await http().get('/api/v1/admin/cases').set(editor).expect(200);
      await http().get('/api/v1/admin/cases').set(admin).expect(200);
    });
  });

  it('full lifecycle: create → patch → publish → public → unpublish → public 404', async () => {
    const tech = await createTechnology(prisma, {
      name: 'NestJS',
      slug: 'nestjs',
    });

    // Create (minimal body): slug generated, DRAFT, defaults.
    const created = await http()
      .post('/api/v1/admin/cases')
      .set(editor)
      .send({
        type: 'TOOL',
        translations: { ES: { title: 'Diseño de Muebles' } },
      })
      .expect(201);
    const id: string = created.body.id;
    expect(created.body).toMatchObject({
      type: 'TOOL',
      client: null,
      anonymizeClient: false,
      year: null,
      coverImageUrl: null,
      includeInKnowledgeBase: true,
      sortOrder: 1,
      technologyIds: [],
      images: [],
      translations: {
        ES: {
          title: 'Diseño de Muebles',
          slug: 'diseno-de-muebles',
          tagline: null,
          summary: '',
          industry: null,
          blocks: [],
          seoTitle: null,
          seoDescription: null,
          status: 'DRAFT',
          publishedAt: null,
        },
        EN: null,
      },
    });

    // Publishing an incomplete locale: 422 with the missing fields.
    const incomplete = await http()
      .post(`/api/v1/admin/cases/${id}/publish`)
      .set(editor)
      .send({ locale: 'ES' })
      .expect(422);
    expect(incomplete.body).toMatchObject({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message:
        'No se puede publicar la versión ES. Falta: resumen, al menos un bloque',
      details: { locale: 'ES', missing: ['summary', 'blocks'] },
    });

    // Patch case fields, technologies and the ES translation; create EN.
    const patched = await http()
      .patch(`/api/v1/admin/cases/${id}`)
      .set(editor)
      .send({
        client: 'Taller Pérez',
        anonymizeClient: true,
        year: 2026,
        coverImageUrl: 'http://localhost:3001/uploads/2026/10/cover.png',
        technologyIds: [tech],
        translations: {
          ES: {
            summary: 'Del diseño al plano de corte.',
            industry: 'Carpintería',
            blocks: [
              { type: 'text', title: 'El reto', body: 'Texto' },
              {
                type: 'metrics',
                items: [{ value: '18%', label: 'menos desperdicio' }],
              },
            ],
            seoDescription: 'Herramienta de despiece',
          },
          EN: { title: 'Furniture design' },
        },
      })
      .expect(200);
    expect(patched.body).toMatchObject({
      client: 'Taller Pérez',
      anonymizeClient: true,
      year: 2026,
      technologyIds: [tech],
      translations: {
        ES: { summary: 'Del diseño al plano de corte.', status: 'DRAFT' },
        EN: {
          title: 'Furniture design',
          slug: 'furniture-design',
          status: 'DRAFT',
        },
      },
    });

    const published = await http()
      .post(`/api/v1/admin/cases/${id}/publish`)
      .set(editor)
      .send({ locale: 'ES' })
      .expect(200);
    expect(published.body.translations.ES.status).toBe('PUBLISHED');
    const publishedAt = published.body.translations.ES.publishedAt;
    expect(publishedAt).toEqual(expect.any(String));

    // Visible publicly in ES only; the client is anonymised.
    const pub = await http()
      .get('/api/v1/cases/diseno-de-muebles?locale=es')
      .expect(200);
    expect(pub.body).toMatchObject({
      title: 'Diseño de Muebles',
      client: null,
      industry: 'Carpintería',
      technologies: [{ name: 'NestJS', slug: 'nestjs' }],
      alternates: { es: 'diseno-de-muebles', en: null },
      next: null,
    });
    await http().get('/api/v1/cases/furniture-design?locale=en').expect(404);

    // Editing a published translation keeps it published...
    const edited = await http()
      .patch(`/api/v1/admin/cases/${id}`)
      .set(editor)
      .send({ translations: { ES: { title: 'Diseño de muebles a medida' } } })
      .expect(200);
    expect(edited.body.translations.ES).toMatchObject({
      status: 'PUBLISHED',
      publishedAt,
    });
    // ...but cannot leave it incomplete.
    await http()
      .patch(`/api/v1/admin/cases/${id}`)
      .set(editor)
      .send({ translations: { ES: { blocks: [] } } })
      .expect(422);

    // Unpublish: gone from the public site. Republishing keeps publishedAt.
    await http()
      .post(`/api/v1/admin/cases/${id}/unpublish`)
      .set(editor)
      .send({ locale: 'ES' })
      .expect(200);
    await http().get('/api/v1/cases/diseno-de-muebles?locale=es').expect(404);
    const republished = await http()
      .post(`/api/v1/admin/cases/${id}/publish`)
      .set(admin)
      .send({ locale: 'es' })
      .expect(200);
    expect(republished.body.translations.ES.publishedAt).toBe(publishedAt);

    // Soft delete.
    await http()
      .delete(`/api/v1/admin/cases/${id}`)
      .set(editor)
      .expect(204, '');
    await http().get(`/api/v1/admin/cases/${id}`).set(editor).expect(404);
    await http().delete(`/api/v1/admin/cases/${id}`).set(editor).expect(404);
    await http().get('/api/v1/cases/diseno-de-muebles?locale=es').expect(404);
    expect(
      await prisma.case.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ deletedAt: expect.any(Date) });
  });

  describe('validation and conflicts', () => {
    let id: string;

    beforeEach(async () => {
      await createCase(prisma, {
        translations: { ES: { title: 'Otro', slug: 'otro' } },
      });
      id = await createCase(prisma, {
        sortOrder: 1,
        translations: { ES: { title: 'Mío', slug: 'mio', status: 'DRAFT' } },
      });
    });

    it.each([
      ['a missing type', { translations: { ES: { title: 'X' } } }],
      [
        'an unknown property',
        { type: 'SAAS', translations: { ES: { title: 'X' } }, extra: 1 },
      ],
      ['no locale', { type: 'SAAS', translations: {} }],
      [
        'an unknown locale',
        { type: 'SAAS', translations: { FR: { title: 'X' } } },
      ],
      [
        'an empty title',
        { type: 'SAAS', translations: { ES: { title: '  ' } } },
      ],
      [
        'an invalid slug',
        {
          type: 'SAAS',
          translations: { ES: { title: 'X', slug: 'Not Valid' } },
        },
      ],
    ])('POST returns 400 for %s', async (_, body) => {
      await http()
        .post('/api/v1/admin/cases')
        .set(admin)
        .send(body)
        .expect(400);
    });

    it('POST returns 409 for a slug in use', async () => {
      const res = await http()
        .post('/api/v1/admin/cases')
        .set(admin)
        .send({
          type: 'SAAS',
          translations: { ES: { title: 'X', slug: 'otro' } },
        })
        .expect(409);
      expect(res.body.message).toBe(
        'El slug "otro" ya está en uso en otro caso (ES)',
      );
    });

    it('POST generates a unique slug when the title slug is taken', async () => {
      const res = await http()
        .post('/api/v1/admin/cases')
        .set(admin)
        .send({ type: 'SAAS', translations: { ES: { title: 'Otro' } } })
        .expect(201);
      expect(res.body.translations.ES.slug).toBe('otro-2');
    });

    it('PATCH returns 409 for a slug in use and 200 for its own slug', async () => {
      await http()
        .patch(`/api/v1/admin/cases/${id}`)
        .set(admin)
        .send({ translations: { ES: { slug: 'otro' } } })
        .expect(409);
      await http()
        .patch(`/api/v1/admin/cases/${id}`)
        .set(admin)
        .send({ translations: { ES: { slug: 'mio' } } })
        .expect(200);
    });

    it.each([
      [
        'a block of unknown type',
        { translations: { ES: { blocks: [{ type: 'video' }] } } },
      ],
      [
        'more than 50 blocks',
        {
          translations: {
            ES: {
              blocks: Array(51).fill({ type: 'text', title: 't', body: 'b' }),
            },
          },
        },
      ],
      [
        'an image of another case',
        {
          translations: {
            ES: { blocks: [{ type: 'gallery', imageIds: ['img-x'] }] },
          },
        },
      ],
      ['null for a non-nullable field', { type: null }],
      ['an unknown technology', { technologyIds: ['nope'] }],
      ['repeated technologies', { technologyIds: ['a', 'a'] }],
      ['an invalid cover URL', { coverImageUrl: 'javascript:alert(1)' }],
      [
        'a too long seoDescription',
        { translations: { ES: { seoDescription: 'x'.repeat(161) } } },
      ],
      ['an unknown property', { status: 'PUBLISHED' }],
    ])('PATCH returns 400 for %s', async (_, body) => {
      const res = await http()
        .patch(`/api/v1/admin/cases/${id}`)
        .set(admin)
        .send(body)
        .expect(400);
      expect(res.body.statusCode).toBe(400);
    });

    it('PATCH accepts null to clear nullable fields', async () => {
      const res = await http()
        .patch(`/api/v1/admin/cases/${id}`)
        .set(admin)
        .send({
          client: null,
          year: null,
          coverImageUrl: null,
          translations: { ES: { tagline: null } },
        })
        .expect(200);
      expect(res.body).toMatchObject({
        client: null,
        year: null,
        coverImageUrl: null,
      });
    });

    it.each([
      ['GET', ''],
      ['PATCH', ''],
      ['POST', '/publish'],
      ['POST', '/unpublish'],
      ['DELETE', ''],
      ['POST', '/images'],
    ])('%s returns 404 for an unknown case id', async (method, suffix) => {
      const body =
        suffix === '/images'
          ? { url: 'https://cdn.test/x.png' }
          : suffix
            ? { locale: 'ES' }
            : {};
      const res = await http()
        [method.toLowerCase() as 'get'](
          `/api/v1/admin/cases/does-not-exist${suffix}`,
        )
        .set(admin)
        .send(body)
        .expect(404);
      expect(res.body.message).toBe('Caso no encontrado');
    });

    it('publish returns 400 for an invalid locale and 404 to unpublish a missing locale', async () => {
      await http()
        .post(`/api/v1/admin/cases/${id}/publish`)
        .set(admin)
        .send({ locale: 'FR' })
        .expect(400);
      await http()
        .post(`/api/v1/admin/cases/${id}/unpublish`)
        .set(admin)
        .send({ locale: 'EN' })
        .expect(404);
    });
  });

  describe('GET /api/v1/admin/cases (list)', () => {
    beforeEach(async () => {
      await createCase(prisma, {
        type: 'SAAS',
        sortOrder: 2,
        translations: {
          ES: { title: 'Zeta', slug: 'zeta' },
          EN: { title: 'Alpha EN', slug: 'alpha-en', status: 'DRAFT' },
        },
      });
      await createCase(prisma, {
        type: 'TOOL',
        sortOrder: 1,
        translations: { ES: { title: 'Beta', slug: 'beta', status: 'DRAFT' } },
      });
      await createCase(prisma, {
        type: 'TOOL',
        sortOrder: 3,
        translations: { EN: { title: 'Gamma', slug: 'gamma' } },
      });
      await createCase(prisma, {
        sortOrder: 0,
        deleted: true,
        translations: { ES: { title: 'Borrado', slug: 'borrado' } },
      });
    });

    const titles = (body: {
      data: {
        translations: {
          ES: { title: string } | null;
          EN: { title: string } | null;
        };
      }[];
    }) => body.data.map((c) => (c.translations.ES ?? c.translations.EN)!.title);

    it('paginates non-deleted cases by sortOrder with per-locale summaries', async () => {
      const res = await http()
        .get('/api/v1/admin/cases?limit=2')
        .set(admin)
        .expect(200);

      expect(res.body.meta).toEqual({ page: 1, limit: 2, total: 3 });
      expect(titles(res.body)).toEqual(['Beta', 'Zeta']);
      expect(res.body.data[1]).toEqual({
        id: expect.any(String),
        type: 'SAAS',
        sortOrder: 2,
        updatedAt: expect.any(String),
        coverImageUrl: null,
        translations: {
          ES: { title: 'Zeta', slug: 'zeta', status: 'PUBLISHED' },
          EN: { title: 'Alpha EN', slug: 'alpha-en', status: 'DRAFT' },
        },
      });

      const page2 = await http()
        .get('/api/v1/admin/cases?limit=2&page=2')
        .set(admin)
        .expect(200);
      expect(titles(page2.body)).toEqual(['Gamma']);
    });

    it('searches titles in both locales, case-insensitively', async () => {
      const res = await http()
        .get('/api/v1/admin/cases?q=alpha')
        .set(admin)
        .expect(200);
      expect(titles(res.body)).toEqual(['Zeta']);
    });

    it('filters by type and by status in any locale', async () => {
      const tool = await http()
        .get('/api/v1/admin/cases?type=TOOL')
        .set(admin)
        .expect(200);
      expect(titles(tool.body)).toEqual(['Beta', 'Gamma']);

      const drafts = await http()
        .get('/api/v1/admin/cases?status=draft')
        .set(admin)
        .expect(200);
      expect(titles(drafts.body)).toEqual(['Beta', 'Zeta']);

      const published = await http()
        .get('/api/v1/admin/cases?status=published')
        .set(admin)
        .expect(200);
      expect(titles(published.body)).toEqual(['Zeta', 'Gamma']);
    });

    it('sorts by title (ES, falling back to EN) and by updatedAt', async () => {
      const asc = await http()
        .get('/api/v1/admin/cases?sort=title')
        .set(admin)
        .expect(200);
      expect(titles(asc.body)).toEqual(['Beta', 'Gamma', 'Zeta']);

      const desc = await http()
        .get('/api/v1/admin/cases?sort=title&order=desc&limit=1')
        .set(admin)
        .expect(200);
      expect(titles(desc.body)).toEqual(['Zeta']);
      expect(desc.body.meta.total).toBe(3);

      await http()
        .get('/api/v1/admin/cases?sort=updatedAt')
        .set(admin)
        .expect(200);
    });

    it.each([
      'limit=0',
      'limit=101',
      'page=0',
      'sort=client',
      'status=archived',
      'order=up',
    ])('returns 400 for %s', async (query) => {
      await http().get(`/api/v1/admin/cases?${query}`).set(admin).expect(400);
    });
  });

  describe('PUT /api/v1/admin/cases/order', () => {
    it('sets sortOrder from the position of each id', async () => {
      const a = await createCase(prisma, {
        sortOrder: 1,
        translations: { ES: { title: 'A', slug: 'a' } },
      });
      const b = await createCase(prisma, {
        sortOrder: 2,
        translations: { ES: { title: 'B', slug: 'b' } },
      });
      const deleted = await createCase(prisma, {
        deleted: true,
        translations: { ES: { title: 'D', slug: 'd' } },
      });

      await http()
        .put('/api/v1/admin/cases/order')
        .set(admin)
        .send({ ids: [b] })
        .expect(400);
      await http()
        .put('/api/v1/admin/cases/order')
        .set(admin)
        .send({ ids: [b, a, deleted] })
        .expect(400);
      await http()
        .put('/api/v1/admin/cases/order')
        .set(admin)
        .send({ ids: [b, a] })
        .expect(204);

      const res = await http().get('/api/v1/cases?locale=es').expect(200);
      expect(res.body.data.map((c: { slug: string }) => c.slug)).toEqual([
        'b',
        'a',
      ]);
    });
  });

  describe('images', () => {
    it('adds, edits and deletes images; deleting removes them from gallery blocks', async () => {
      const id = await createCase(prisma, {
        translations: {
          ES: { title: 'Con galería', slug: 'con-galeria' },
          EN: { title: 'Gallery', slug: 'gallery' },
        },
      });

      const first = await http()
        .post(`/api/v1/admin/cases/${id}/images`)
        .set(editor)
        .send({
          url: 'http://localhost:3001/uploads/2026/10/a.png',
          alt: { ES: 'Plano', EN: 'Plan' },
        })
        .expect(201);
      expect(first.body).toEqual({
        id: expect.any(String),
        url: 'http://localhost:3001/uploads/2026/10/a.png',
        alt: { ES: 'Plano', EN: 'Plan' },
        sortOrder: 1,
      });
      const second = await http()
        .post(`/api/v1/admin/cases/${id}/images`)
        .set(editor)
        .send({ url: 'https://cdn.test/b.png' })
        .expect(201);
      expect(second.body).toMatchObject({
        alt: { ES: null, EN: null },
        sortOrder: 2,
      });

      const updated = await http()
        .patch(`/api/v1/admin/cases/${id}/images/${second.body.id}`)
        .set(editor)
        .send({ alt: { EN: 'Second' }, sortOrder: 0 })
        .expect(200);
      expect(updated.body).toMatchObject({
        alt: { ES: null, EN: 'Second' },
        sortOrder: 0,
      });

      const gallery = [
        { type: 'gallery', imageIds: [first.body.id, second.body.id] },
      ];
      await http()
        .patch(`/api/v1/admin/cases/${id}`)
        .set(editor)
        .send({
          translations: { ES: { blocks: gallery }, EN: { blocks: gallery } },
        })
        .expect(200);

      const before = await http()
        .get('/api/v1/cases/gallery?locale=en')
        .expect(200);
      expect(before.body.blocks).toEqual([
        {
          type: 'gallery',
          images: [
            { url: 'http://localhost:3001/uploads/2026/10/a.png', alt: 'Plan' },
            { url: 'https://cdn.test/b.png', alt: 'Second' },
          ],
          caption: null,
        },
      ]);

      await http()
        .delete(`/api/v1/admin/cases/${id}/images/${first.body.id}`)
        .set(editor)
        .expect(204);

      const detail = await http()
        .get(`/api/v1/admin/cases/${id}`)
        .set(editor)
        .expect(200);
      expect(detail.body.images.map((i: { id: string }) => i.id)).toEqual([
        second.body.id,
      ]);
      expect(detail.body.translations.ES.blocks).toEqual([
        { type: 'gallery', imageIds: [second.body.id] },
      ]);
      expect(detail.body.translations.EN.blocks).toEqual([
        { type: 'gallery', imageIds: [second.body.id] },
      ]);

      await http()
        .delete(`/api/v1/admin/cases/${id}/images/${first.body.id}`)
        .set(editor)
        .expect(404);
    });

    it('validates the image body', async () => {
      const id = await createCase(prisma, {
        translations: { ES: { title: 'X', slug: 'x' } },
      });
      await http()
        .post(`/api/v1/admin/cases/${id}/images`)
        .set(editor)
        .send({ url: 'not a url' })
        .expect(400);
      await http()
        .post(`/api/v1/admin/cases/${id}/images`)
        .set(editor)
        .send({ url: 'https://cdn.test/a.png', alt: { FR: 'x' } })
        .expect(400);
    });

    it('does not let a case use or edit the images of another case', async () => {
      const a = await createCase(prisma, {
        images: [{ id: 'img-of-a', url: 'https://cdn.test/a.png' }],
        translations: { ES: { title: 'A', slug: 'a', status: 'DRAFT' } },
      });
      const b = await createCase(prisma, {
        translations: { ES: { title: 'B', slug: 'b', status: 'DRAFT' } },
      });

      const res = await http()
        .patch(`/api/v1/admin/cases/${b}`)
        .set(editor)
        .send({
          translations: {
            ES: { blocks: [{ type: 'gallery', imageIds: ['img-of-a'] }] },
          },
        })
        .expect(400);
      expect(res.body.message).toEqual([
        'blocks[0].imageIds[0] ("img-of-a") no es una imagen de este caso',
      ]);
      await http()
        .patch(`/api/v1/admin/cases/${b}/images/img-of-a`)
        .set(editor)
        .send({ sortOrder: 1 })
        .expect(404);
      await http()
        .delete(`/api/v1/admin/cases/${b}/images/img-of-a`)
        .set(editor)
        .expect(404);
      expect(await prisma.caseImage.count({ where: { caseId: a } })).toBe(1);
    });
  });
});
