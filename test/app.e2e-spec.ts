import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { setupApp } from './../src/setup-app.js';

describe('API (e2e)', () => {
  let app: NestExpressApplication;
  const queryRaw = vi.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw, $disconnect: vi.fn() })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 when the database is up', async () => {
      queryRaw.mockResolvedValueOnce([{ pgvector: true }]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'ok',
        database: 'up',
        pgvector: true,
      });
    });

    it('returns 503 when the database is down', async () => {
      queryRaw.mockImplementationOnce(() =>
        Promise.reject(new Error('connect ECONNREFUSED')),
      );

      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(503);

      expect(res.body).toMatchObject({ status: 'error', database: 'down' });
    });
  });

  it('answers unknown routes with the shared error format', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);

    expect(res.body).toMatchObject({
      statusCode: 404,
      path: '/api/v1/does-not-exist',
    });
    expect(res.body.timestamp).toEqual(expect.any(String));
  });

  it('sends helmet security headers on API routes', async () => {
    queryRaw.mockResolvedValueOnce([{ pgvector: true }]);
    const res = await request(app.getHttpServer()).get('/api/v1/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(res.headers['x-powered-by']).toBeUndefined();
    // Errors carry them too.
    const missing = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);
    expect(missing.headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps CORS preflights working with credentials next to helmet', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/admin/cases')
      .set('Origin', 'http://localhost:3002')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3002',
    );
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']).toMatch(
      /authorization/i,
    );
    // Not an allowed origin: no CORS headers.
    const other = await request(app.getHttpServer())
      .options('/api/v1/admin/cases')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows CORS from front-mwp', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');

    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
  });
});
