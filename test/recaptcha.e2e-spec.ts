import { BadRequestException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  RECAPTCHA_FAILED_MESSAGE,
  RecaptchaService,
} from '../src/modules/leads/recaptcha.service.js';
import {
  createTestApp,
  resetThrottler,
  truncateAll,
} from './utils/test-app.js';

const FORM = {
  name: 'Ana Torres',
  email: 'ana@example.com',
  message: 'Queremos una plataforma de citas para tres sedes.',
  locale: 'es',
  consent: true,
  website: '',
};

/** Stands in for Google: only "good-token" passes. Never calls the network. */
const fakeRecaptcha = {
  calls: [] as { token: string | undefined; ip: string | undefined }[],
  async verify(token: string | undefined, ip?: string): Promise<void> {
    this.calls.push({ token, ip });
    if (token !== 'good-token') {
      throw new BadRequestException({
        message: RECAPTCHA_FAILED_MESSAGE,
        error: 'Bad Request',
        details: { reason: 'recaptcha_failed' },
      });
    }
  },
};

describe('POST /leads with reCAPTCHA (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const post = (body: object) =>
    request(app.getHttpServer())
      .post('/api/v1/leads')
      .set('X-Forwarded-For', '203.0.113.200')
      .send(body);

  beforeAll(async () => {
    app = await createTestApp([], (builder) =>
      builder.overrideProvider(RecaptchaService).useValue(fakeRecaptcha),
    );
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    resetThrottler(app);
    fakeRecaptcha.calls = [];
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  it('answers 400 recaptcha_failed for a missing or bad token and stores nothing', async () => {
    for (const body of [FORM, { ...FORM, recaptchaToken: 'bad-token' }]) {
      const res = await post(body).expect(400);
      expect(res.body.message).toBe(RECAPTCHA_FAILED_MESSAGE);
      expect(res.body.details).toEqual({ reason: 'recaptcha_failed' });
    }
    expect(await prisma.lead.count()).toBe(0);
  });

  it('creates the lead with a good token, passing the client IP', async () => {
    const res = await post({ ...FORM, recaptchaToken: 'good-token' }).expect(
      201,
    );
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'id']);
    expect(await prisma.lead.count()).toBe(1);
    expect(fakeRecaptcha.calls).toEqual([
      { token: 'good-token', ip: '203.0.113.200' },
    ]);
  });

  it('skips the check for the honeypot (fake 201, no Google call)', async () => {
    await post({ ...FORM, website: 'http://spam.example' }).expect(201);
    expect(fakeRecaptcha.calls).toEqual([]);
    expect(await prisma.lead.count()).toBe(0);
  });

  it('rejected requests still count toward the 5/hour limit', async () => {
    for (let i = 0; i < 5; i++) await post(FORM).expect(400);
    await post({ ...FORM, recaptchaToken: 'good-token' }).expect(429);
  });
});
