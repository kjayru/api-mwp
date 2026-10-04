import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import {
  REVALIDATION_OPTIONS,
  type RevalidationOptions,
} from '../src/common/revalidation/revalidation.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { accessToken, bearer } from './utils/auth.js';
import {
  createBlogPost,
  createCase,
  createService,
  createTechnology,
} from './utils/content.js';
import { createTestApp, truncateAll } from './utils/test-app.js';

interface Hit {
  headers: IncomingHttpHeaders;
  body: { tags: string[] };
}

const SECRET = 'e2e-revalidate-secret-0123456789abcdef';

/** The front's revalidation route, played by a local HTTP server. */
describe('Front revalidation webhook (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let server: Server;
  let editor: { Authorization: string };
  let hits: Hit[];
  let status: number;
  let waiters: (() => void)[];
  const http = () => request(app.getHttpServer());

  /** Resolves with the next webhook call (they are fire-and-forget). */
  function nextHit(): Promise<Hit> {
    const already = hits.length;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('webhook not called')),
        3000,
      );
      const check = () => {
        if (hits.length > already) {
          clearTimeout(timer);
          resolve(hits[already]);
        } else {
          waiters.push(check);
        }
      };
      check();
    });
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/api/revalidate') {
          hits.push({ headers: req.headers, body: JSON.parse(raw) });
        }
        res.writeHead(status, { 'content-type': 'application/json' }).end('{}');
        const pending = waiters;
        waiters = [];
        pending.forEach((fn) => fn());
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const options: RevalidationOptions = {
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/revalidate`,
      secret: SECRET,
      timeoutMs: 3000,
    };

    app = await createTestApp([], (builder) =>
      builder.overrideProvider(REVALIDATION_OPTIONS).useValue(options),
    );
    prisma = app.get(PrismaService);
    editor = bearer(accessToken(app, 'EDITOR'));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    hits = [];
    waiters = [];
    status = 200;
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('publishing a case sends the case, list and stats tags with the secret', async () => {
    const id = await createCase(prisma, {
      translations: {
        ES: { title: 'Caso', slug: 'caso', status: 'DRAFT' },
        EN: { title: 'Case', slug: 'case', status: 'DRAFT' },
      },
    });

    const hit = nextHit();
    await http()
      .post(`/api/v1/admin/cases/${id}/publish`)
      .set(editor)
      .send({ locale: 'ES' })
      .expect(200);

    const { headers, body } = await hit;
    expect(headers['x-revalidate-secret']).toBe(SECRET);
    expect(headers['content-type']).toBe('application/json');
    expect(body.tags.sort()).toEqual([
      'case:case',
      'case:caso',
      'cases',
      'stats',
    ]);
  });

  it('a slug change revalidates the old and the new slug', async () => {
    const id = await createCase(prisma, {
      translations: { ES: { title: 'Caso', slug: 'viejo' } },
    });

    const hit = nextHit();
    await http()
      .patch(`/api/v1/admin/cases/${id}`)
      .set(editor)
      .send({ translations: { ES: { slug: 'nuevo' } } })
      .expect(200);

    expect((await hit).body.tags).toEqual(
      expect.arrayContaining(['cases', 'stats', 'case:viejo', 'case:nuevo']),
    );
  });

  it('technology and service mutations send their tags', async () => {
    const tech = await createTechnology(prisma, {
      name: 'NestJS',
      slug: 'nestjs',
    });
    let hit = nextHit();
    await http()
      .patch(`/api/v1/admin/technologies/${tech}`)
      .set(editor)
      .send({ name: 'Nest' })
      .expect(200);
    expect((await hit).body.tags).toEqual([
      'technologies',
      'cases',
      'services',
      'stats',
      'blog',
    ]);

    const service = await createService(prisma, {
      translations: { ES: { title: 'APIs', slug: 'apis' } },
    });
    hit = nextHit();
    await http()
      .delete(`/api/v1/admin/services/${service}`)
      .set(editor)
      .expect(204);
    expect((await hit).body.tags).toEqual(['services']);
  });

  it('creating a draft case or blog post sends nothing', async () => {
    await http()
      .post('/api/v1/admin/cases')
      .set(editor)
      .send({ type: 'SAAS', translations: { ES: { title: 'Borrador' } } })
      .expect(201);
    await http()
      .post('/api/v1/admin/blog')
      .set(editor)
      .send({ translations: { ES: { title: 'Borrador' } } })
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(hits).toEqual([]);
  });

  it('blog mutations send blog and post:<slug> for every slug, old and new', async () => {
    const id = await createBlogPost(prisma, {
      translations: {
        ES: { title: 'Artículo', slug: 'articulo', status: 'DRAFT' },
        EN: { title: 'Post', slug: 'post', status: 'DRAFT' },
      },
    });

    let hit = nextHit();
    await http()
      .post(`/api/v1/admin/blog/${id}/publish`)
      .set(editor)
      .send({ locale: 'ES' })
      .expect(200);
    const published = await hit;
    expect(published.headers['x-revalidate-secret']).toBe(SECRET);
    expect(published.body.tags.sort()).toEqual([
      'blog',
      'post:articulo',
      'post:post',
    ]);

    hit = nextHit();
    await http()
      .patch(`/api/v1/admin/blog/${id}`)
      .set(editor)
      .send({ translations: { ES: { slug: 'articulo-nuevo' } } })
      .expect(200);
    expect((await hit).body.tags.sort()).toEqual([
      'blog',
      'post:articulo',
      'post:articulo-nuevo',
      'post:post',
    ]);

    hit = nextHit();
    await http()
      .patch(`/api/v1/admin/blog/${id}`)
      .set(editor)
      .send({ coverImageUrl: 'http://localhost:3001/uploads/a.webp' })
      .expect(200);
    expect((await hit).body.tags.sort()).toEqual([
      'blog',
      'post:articulo-nuevo',
      'post:post',
    ]);

    hit = nextHit();
    await http()
      .post(`/api/v1/admin/blog/${id}/unpublish`)
      .set(editor)
      .send({ locale: 'ES' })
      .expect(200);
    expect((await hit).body.tags).toContain('post:articulo-nuevo');

    hit = nextHit();
    await http().delete(`/api/v1/admin/blog/${id}`).set(editor).expect(204);
    expect((await hit).body.tags.sort()).toEqual([
      'blog',
      'post:articulo-nuevo',
      'post:post',
    ]);
  });

  it('a failing front never fails the admin request', async () => {
    status = 500;
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const id = await createCase(prisma, {
      translations: { ES: { title: 'Caso', slug: 'caso' } },
    });

    const hit = nextHit();
    await http()
      .post(`/api/v1/admin/cases/${id}/unpublish`)
      .set(editor)
      .send({ locale: 'ES' })
      .expect(200);
    await hit;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('answered 500'));
    warn.mockRestore();
  });
});
