import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { accessToken, bearer } from './utils/auth.js';
import {
  createCase,
  createService,
  createTechnology,
} from './utils/content.js';
import { createTestApp, truncateAll } from './utils/test-app.js';

describe('Admin technologies and services (e2e, real database)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let editor: { Authorization: string };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    editor = bearer(accessToken(app, 'EDITOR'));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  describe('technologies', () => {
    it.each([
      ['GET', '/api/v1/admin/technologies'],
      ['POST', '/api/v1/admin/technologies'],
      ['PATCH', '/api/v1/admin/technologies/x'],
      ['DELETE', '/api/v1/admin/technologies/x'],
      ['PUT', '/api/v1/admin/technologies/order'],
    ])('%s %s returns 401 without a token', async (method, url) => {
      await http()[method.toLowerCase() as 'get'](url).expect(401);
    });

    it('CRUD: create, list with usage, update, reorder, soft delete', async () => {
      const created = await http()
        .post('/api/v1/admin/technologies')
        .set(editor)
        .send({
          name: 'Next.js',
          category: 'FRONTEND',
          isFeatured: true,
          descriptions: { ES: 'Framework de React' },
        })
        .expect(201);
      expect(created.body).toEqual({
        id: expect.any(String),
        name: 'Next.js',
        slug: 'next-js',
        category: 'FRONTEND',
        isFeatured: true,
        sortOrder: 1,
        descriptions: { ES: 'Framework de React', EN: null },
        usage: { cases: 0, services: 0 },
      });
      const id: string = created.body.id;

      // Duplicate name (any case) or slug: 409.
      await http()
        .post('/api/v1/admin/technologies')
        .set(editor)
        .send({ name: 'next.js' })
        .expect(409);
      const slugConflict = await http()
        .post('/api/v1/admin/technologies')
        .set(editor)
        .send({ name: 'Next', slug: 'next-js' })
        .expect(409);
      expect(slugConflict.body.message).toBe(
        'El slug "next-js" ya está en uso en otra tecnología',
      );

      const other = await createTechnology(prisma, {
        name: 'Laravel',
        slug: 'laravel',
        sortOrder: 2,
      });
      await createCase(prisma, {
        technologies: [id],
        translations: { ES: { title: 'Caso', slug: 'caso' } },
      });
      await createCase(prisma, {
        deleted: true,
        technologies: [id],
        translations: { ES: { title: 'Borrado', slug: 'borrado' } },
      });
      await createService(prisma, {
        technologies: [id, other],
        translations: { ES: { title: 'Webs', slug: 'webs' } },
      });

      const list = await http()
        .get('/api/v1/admin/technologies')
        .set(editor)
        .expect(200);
      expect(list.body.data.map((t: { name: string }) => t.name)).toEqual([
        'Next.js',
        'Laravel',
      ]);
      expect(list.body.data[0].usage).toEqual({ cases: 1, services: 1 });

      const updated = await http()
        .patch(`/api/v1/admin/technologies/${id}`)
        .set(editor)
        .send({
          slug: 'nextjs',
          descriptions: { ES: null, EN: 'React framework' },
        })
        .expect(200);
      expect(updated.body).toMatchObject({
        slug: 'nextjs',
        descriptions: { ES: null, EN: 'React framework' },
      });
      await http()
        .patch(`/api/v1/admin/technologies/${id}`)
        .set(editor)
        .send({ name: 'laravel' })
        .expect(409);

      await http()
        .put('/api/v1/admin/technologies/order')
        .set(editor)
        .send({ ids: [other] })
        .expect(400);
      await http()
        .put('/api/v1/admin/technologies/order')
        .set(editor)
        .send({ ids: [other, id] })
        .expect(204);
      const reordered = await http()
        .get('/api/v1/technologies?locale=es')
        .expect(200);
      expect(reordered.body.data.map((t: { slug: string }) => t.slug)).toEqual([
        'laravel',
        'nextjs',
      ]);

      // Deleting a technology in use is allowed; it disappears publicly.
      await http()
        .delete(`/api/v1/admin/technologies/${id}`)
        .set(editor)
        .expect(204);
      await http()
        .delete(`/api/v1/admin/technologies/${id}`)
        .set(editor)
        .expect(404);
      await http()
        .get(`/api/v1/admin/technologies/${id}`)
        .set(editor)
        .expect(404);
      const pubCase = await http()
        .get('/api/v1/cases/caso?locale=es')
        .expect(200);
      expect(pubCase.body.technologies).toEqual([]);
      const pubServices = await http()
        .get('/api/v1/services?locale=es')
        .expect(200);
      expect(pubServices.body.data[0].technologies).toEqual([
        { name: 'Laravel', slug: 'laravel' },
      ]);
      expect(
        await prisma.caseTechnology.count({ where: { technologyId: id } }),
      ).toBe(2);
    });

    it.each([
      ['an empty name', { name: ' ' }],
      ['an invalid category', { name: 'X', category: 'GAMES' }],
      ['an invalid slug', { name: 'X', slug: 'X Y' }],
      ['an unknown property', { name: 'X', deletedAt: null }],
    ])('POST returns 400 for %s', async (_, body) => {
      await http()
        .post('/api/v1/admin/technologies')
        .set(editor)
        .send(body)
        .expect(400);
    });
  });

  describe('services', () => {
    it.each([
      ['GET', '/api/v1/admin/services'],
      ['POST', '/api/v1/admin/services'],
      ['POST', '/api/v1/admin/services/x/publish'],
    ])('%s %s returns 401 without a token', async (method, url) => {
      await http()[method.toLowerCase() as 'get'](url).expect(401);
    });

    it('lifecycle: create → publish 422 → patch → publish → public → unpublish → delete', async () => {
      const tech = await createTechnology(prisma, {
        name: 'NestJS',
        slug: 'nestjs',
      });

      const created = await http()
        .post('/api/v1/admin/services')
        .set(editor)
        .send({
          technologyIds: [tech],
          translations: { ES: { title: 'Apps móviles' } },
        })
        .expect(201);
      const id: string = created.body.id;
      expect(created.body).toEqual({
        id: expect.any(String),
        sortOrder: 1,
        technologyIds: [tech],
        translations: {
          ES: {
            title: 'Apps móviles',
            slug: 'apps-moviles',
            description: '',
            status: 'DRAFT',
            publishedAt: null,
          },
          EN: null,
        },
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const incomplete = await http()
        .post(`/api/v1/admin/services/${id}/publish`)
        .set(editor)
        .send({ locale: 'ES' })
        .expect(422);
      expect(incomplete.body.message).toBe(
        'No se puede publicar la versión ES. Falta: descripción',
      );

      await http()
        .patch(`/api/v1/admin/services/${id}`)
        .set(editor)
        .send({
          translations: {
            ES: { description: 'iOS y Android' },
            EN: { title: 'Mobile apps', description: 'iOS and Android' },
          },
        })
        .expect(200);
      await http()
        .post(`/api/v1/admin/services/${id}/publish`)
        .set(editor)
        .send({ locale: 'EN' })
        .expect(200);

      const en = await http().get('/api/v1/services?locale=en').expect(200);
      expect(en.body.data).toEqual([
        {
          title: 'Mobile apps',
          slug: 'mobile-apps',
          description: 'iOS and Android',
          technologies: [{ name: 'NestJS', slug: 'nestjs' }],
        },
      ]);
      const es = await http().get('/api/v1/services?locale=es').expect(200);
      expect(es.body.data).toEqual([]);

      await http()
        .patch(`/api/v1/admin/services/${id}`)
        .set(editor)
        .send({ translations: { EN: { description: '' } } })
        .expect(422);

      await http()
        .post(`/api/v1/admin/services/${id}/unpublish`)
        .set(editor)
        .send({ locale: 'EN' })
        .expect(200);
      expect(
        (await http().get('/api/v1/services?locale=en').expect(200)).body.data,
      ).toEqual([]);

      const list = await http()
        .get('/api/v1/admin/services')
        .set(editor)
        .expect(200);
      expect(list.body.data).toHaveLength(1);

      await http()
        .delete(`/api/v1/admin/services/${id}`)
        .set(editor)
        .expect(204);
      await http().get(`/api/v1/admin/services/${id}`).set(editor).expect(404);
      expect(
        (await http().get('/api/v1/admin/services').set(editor).expect(200))
          .body.data,
      ).toEqual([]);
    });

    it('returns 409 for duplicate slugs and 400 for unknown technologies', async () => {
      await createService(prisma, {
        translations: { ES: { title: 'APIs', slug: 'apis' } },
      });

      await http()
        .post('/api/v1/admin/services')
        .set(editor)
        .send({ translations: { ES: { title: 'Otra', slug: 'apis' } } })
        .expect(409);
      await http()
        .post('/api/v1/admin/services')
        .set(editor)
        .send({
          technologyIds: ['nope'],
          translations: { ES: { title: 'Otra' } },
        })
        .expect(400);
      const generated = await http()
        .post('/api/v1/admin/services')
        .set(editor)
        .send({ translations: { ES: { title: 'APIs' } } })
        .expect(201);
      expect(generated.body.translations.ES.slug).toBe('apis-2');
    });

    it('reorders services', async () => {
      const a = await createService(prisma, {
        sortOrder: 1,
        translations: { ES: { title: 'A', slug: 'a' } },
      });
      const b = await createService(prisma, {
        sortOrder: 2,
        translations: { ES: { title: 'B', slug: 'b' } },
      });

      await http()
        .put('/api/v1/admin/services/order')
        .set(editor)
        .send({ ids: [b, a] })
        .expect(204);
      const res = await http().get('/api/v1/services?locale=es').expect(200);
      expect(res.body.data.map((s: { slug: string }) => s.slug)).toEqual([
        'b',
        'a',
      ]);
    });
  });
});
