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

  it('allows CORS from front-mwp', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');

    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
  });
});
