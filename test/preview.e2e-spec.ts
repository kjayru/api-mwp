import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { accessToken, bearer } from './utils/auth.js';
import {
  createBlogPost,
  createCase,
  createUser,
} from './utils/content.js';
import { createTestApp, truncateAll } from './utils/test-app.js';

const SECRET = process.env.PREVIEW_SECRET!;
const SECRET_HEADER = { 'x-preview-secret': SECRET };

describe('Draft preview (e2e, real database)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let editor: { Authorization: string };
  const http = () => request(app.getHttpServer());

  const link = (body: object) =>
    http().post('/api/v1/admin/preview').set(editor).send(body);
  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    editor = bearer(accessToken(app, 'EDITOR'));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await createUser(prisma, { id: 'user-editor', name: 'Editora' });
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  async function seedContent() {
    const published = await createCase(prisma, {
      sortOrder: 1,
      translations: {
        ES: { title: 'Publicado', slug: 'publicado' },
        EN: { title: 'Published', slug: 'published' },
      },
    });
    const draft = await createCase(prisma, {
      sortOrder: 2,
      translations: {
        ES: { title: 'Borrador', slug: 'borrador', status: 'DRAFT' },
        EN: { title: 'Draft', slug: 'draft', status: 'PUBLISHED' },
      },
    });
    const post = await createBlogPost(prisma, {
      translations: {
        ES: { title: 'Post en borrador', slug: 'post-borrador', status: 'DRAFT' },
        EN: { title: 'Published post', slug: 'published-post' },
      },
    });
    return { published, draft, post };
  }

  describe('POST /api/v1/admin/preview', () => {
    it('401 without a token, 403 for a role outside ADMIN/EDITOR, 400 for a bad body', async () => {
      await http().post('/api/v1/admin/preview').send({}).expect(401);
      await http()
        .post('/api/v1/admin/preview')
        .set(bearer(accessToken(app, 'VIEWER' as never)))
        .send({ type: 'case', id: 'x', locale: 'es' })
        .expect(403);
      for (const body of [
        {},
        { type: 'page', id: 'x', locale: 'es' },
        { type: 'case', id: 'x', locale: 'ES' },
        { type: 'case', id: '', locale: 'es' },
        { type: 'case', id: 'x', locale: 'es', extra: 1 },
      ]) {
        await link(body).expect(400);
      }
    });

    it('returns the front URL with a 10 minute token for a draft case and a draft post', async () => {
      const { draft, post } = await seedContent();

      const res = await link({ type: 'case', id: draft, locale: 'es' }).expect(200);
      expect(res.body.url).toMatch(
        /^https:\/\/front\.example\.test\/api\/draft\?token=[\w-]+\.[\w-]+\.[\w-]+$/,
      );
      const expiresIn = Date.parse(res.body.expiresAt) - Date.now();
      expect(expiresIn).toBeGreaterThan(9 * 60_000);
      expect(expiresIn).toBeLessThanOrEqual(10 * 60_000);

      const claims = app.get(JwtService).decode(tokenOf(res.body.url));
      expect(claims).toMatchObject({ type: 'case', id: draft, locale: 'es', aud: 'preview' });

      await link({ type: 'post', id: post, locale: 'es' }).expect(200);
    });

    it('is not signed with the access-token secret', async () => {
      const { draft } = await seedContent();
      const res = await link({ type: 'case', id: draft, locale: 'es' }).expect(200);
      const jwt = app.get(JwtService);
      await expect(jwt.verifyAsync(tokenOf(res.body.url))).rejects.toThrow();
      await expect(
        jwt.verifyAsync(tokenOf(res.body.url), { secret: SECRET, audience: 'preview' }),
      ).resolves.toMatchObject({ id: draft });
    });

    it('404 for unknown or deleted entities', async () => {
      const deleted = await createCase(prisma, {
        deleted: true,
        translations: { ES: { title: 'X', slug: 'x' } },
      });
      await link({ type: 'case', id: 'nope', locale: 'es' }).expect(404);
      await link({ type: 'case', id: deleted, locale: 'es' }).expect(404);
      const deletedPost = await createBlogPost(prisma, {
        deleted: true,
        translations: { ES: { title: 'Y', slug: 'y' } },
      });
      await link({ type: 'post', id: deletedPost, locale: 'es' }).expect(404);
    });

    it('422 no_slug when the locale has no translation', async () => {
      const onlyEs = await createCase(prisma, {
        translations: { ES: { title: 'Solo ES', slug: 'solo-es' } },
      });
      const res = await link({ type: 'case', id: onlyEs, locale: 'en' }).expect(422);
      expect(res.body).toMatchObject({
        statusCode: 422,
        details: { reason: 'no_slug', locale: 'EN' },
      });
    });
  });

  describe('POST /api/v1/preview/resolve', () => {
    it('401 invalid_secret without or with a wrong header (and no token needed to fail)', async () => {
      const res = await http().post('/api/v1/preview/resolve').send({ token: 'x' }).expect(401);
      expect(res.body.details).toEqual({ reason: 'invalid_secret' });
      await http()
        .post('/api/v1/preview/resolve')
        .set('x-preview-secret', `${SECRET}x`)
        .send({ token: 'x' })
        .expect(401);
      await http()
        .post('/api/v1/preview/resolve')
        .set('x-preview-secret', 'short')
        .send({ token: 'x' })
        .expect(401);
      // A valid access token is not a preview secret.
      await http()
        .post('/api/v1/preview/resolve')
        .set(editor)
        .send({ token: 'x' })
        .expect(401);
    });

    it('resolves a valid token to the current slug, with no-store', async () => {
      const { draft } = await seedContent();
      const { body } = await link({ type: 'case', id: draft, locale: 'es' }).expect(200);

      // The slug changed after the link was made.
      await prisma.caseTranslation.updateMany({
        where: { caseId: draft, locale: 'ES' },
        data: { slug: 'borrador-renombrado' },
      });
      const res = await http()
        .post('/api/v1/preview/resolve')
        .set(SECRET_HEADER)
        .send({ token: tokenOf(body.url) })
        .expect(200);
      expect(res.body).toEqual({
        type: 'case',
        id: draft,
        locale: 'es',
        slug: 'borrador-renombrado',
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('401 invalid_token for garbage, expired and wrong-audience tokens; 400 without token', async () => {
      const { draft } = await seedContent();
      const jwt = app.get(JwtService);
      const claims = { type: 'case', id: draft, locale: 'es' };
      const resolve = (token: string) =>
        http().post('/api/v1/preview/resolve').set(SECRET_HEADER).send({ token });

      const expired = jwt.sign(claims, {
        secret: SECRET,
        audience: 'preview',
        algorithm: 'HS256',
        expiresIn: -10,
      });
      const accessLike = jwt.sign(claims, { secret: SECRET, algorithm: 'HS256' });
      const otherSecret = jwt.sign(claims, {
        secret: 'z'.repeat(40),
        audience: 'preview',
        algorithm: 'HS256',
      });
      for (const token of ['garbage', expired, accessLike, otherSecret]) {
        const res = await resolve(token).expect(401);
        expect(res.body.details).toEqual({ reason: 'invalid_token' });
      }
      await http().post('/api/v1/preview/resolve').set(SECRET_HEADER).send({}).expect(400);
    });

    it('404 when the entity was deleted after the link was made', async () => {
      const { post } = await seedContent();
      const { body } = await link({ type: 'post', id: post, locale: 'es' }).expect(200);
      await prisma.blogPost.update({ where: { id: post }, data: { deletedAt: new Date() } });
      await http()
        .post('/api/v1/preview/resolve')
        .set(SECRET_HEADER)
        .send({ token: tokenOf(body.url) })
        .expect(404);
    });
  });

  describe('GET /api/v1/preview/cases/:slug and /blog/:slug', () => {
    it('401 invalid_secret without the header', async () => {
      await seedContent();
      await http().get('/api/v1/preview/cases/borrador?locale=es').expect(401);
      await http()
        .get('/api/v1/preview/blog/post-borrador?locale=es')
        .set('x-preview-secret', 'nope')
        .expect(401);
    });

    it('serves a draft case with the public shape; the public endpoint still hides it', async () => {
      await seedContent();
      await http().get('/api/v1/cases/borrador?locale=es').expect(404);

      const res = await http()
        .get('/api/v1/preview/cases/borrador?locale=es')
        .set(SECRET_HEADER)
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        slug: 'borrador',
        title: 'Borrador',
        publishedAt: null,
        // ES is a draft, EN is published.
        alternates: { es: null, en: 'draft' },
        // A draft has no position among the published cases.
        next: null,
      });
      expect(Object.keys(res.body).sort()).toEqual(
        Object.keys(
          (await http().get('/api/v1/cases/publicado?locale=es').expect(200)).body,
        ).sort(),
      );
    });

    it('serves published content too, and still points only to published neighbours', async () => {
      await seedContent();
      const res = await http()
        .get('/api/v1/preview/cases/publicado?locale=es')
        .set(SECRET_HEADER)
        .expect(200);
      // The only published ES case: no next.
      expect(res.body.next).toBeNull();
      expect(res.body.alternates).toEqual({ es: 'publicado', en: 'published' });
    });

    it('serves a draft post with the public shape', async () => {
      await seedContent();
      await http().get('/api/v1/blog/post-borrador?locale=es').expect(404);
      const res = await http()
        .get('/api/v1/preview/blog/post-borrador?locale=es')
        .set(SECRET_HEADER)
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        slug: 'post-borrador',
        title: 'Post en borrador',
        alternates: { es: null, en: 'published-post' },
        previous: null,
        next: null,
      });
      expect(res.body.content).toContain('Cuerpo del artículo');
    });

    it('404 for an unknown slug, a slug of the other locale, and deleted entities', async () => {
      const { draft, post } = await seedContent();
      const get = (path: string) => http().get(path).set(SECRET_HEADER);
      await get('/api/v1/preview/cases/nope?locale=es').expect(404);
      await get('/api/v1/preview/cases/borrador?locale=en').expect(404);
      await get('/api/v1/preview/blog/nope?locale=es').expect(404);

      await prisma.case.update({ where: { id: draft }, data: { deletedAt: new Date() } });
      await prisma.blogPost.update({ where: { id: post }, data: { deletedAt: new Date() } });
      await get('/api/v1/preview/cases/borrador?locale=es').expect(404);
      await get('/api/v1/preview/blog/post-borrador?locale=es').expect(404);
    });

    it('400 for a missing locale or unknown parameters', async () => {
      await http().get('/api/v1/preview/cases/borrador').set(SECRET_HEADER).expect(400);
      await http()
        .get('/api/v1/preview/blog/x?locale=es&foo=1')
        .set(SECRET_HEADER)
        .expect(400);
    });
  });

  describe('without PREVIEW_SECRET', () => {
    let bare: NestExpressApplication;

    beforeAll(async () => {
      bare = await createTestApp();
      // The validated env is built once, when AppModule is imported, so the
      // secret is hidden on this app's ConfigService only.
      const config = bare.get(ConfigService);
      const get = config.get.bind(config) as (key: string, ...rest: unknown[]) => unknown;
      vi.spyOn(config, 'get').mockImplementation(((key: string, ...rest: unknown[]) =>
        key === 'PREVIEW_SECRET' ? undefined : get(key, ...rest)) as never);
    });

    afterAll(async () => {
      await bare.close();
    });

    it('every preview endpoint answers 503 preview_disabled', async () => {
      const server = () => request(bare.getHttpServer());
      const admin = bearer(accessToken(bare, 'ADMIN'));
      const responses = [
        await server()
          .post('/api/v1/admin/preview')
          .set(admin)
          .send({ type: 'case', id: 'x', locale: 'es' }),
        await server().post('/api/v1/preview/resolve').set(SECRET_HEADER).send({ token: 'x' }),
        await server().get('/api/v1/preview/cases/x?locale=es').set(SECRET_HEADER),
        await server().get('/api/v1/preview/blog/x?locale=es').set(SECRET_HEADER),
        // Even an empty header must not open anything.
        await server().get('/api/v1/preview/blog/x?locale=es'),
      ];
      for (const res of responses) {
        expect(res.status).toBe(503);
        expect(res.body.details).toEqual({ reason: 'preview_disabled' });
      }
    });
  });
});
