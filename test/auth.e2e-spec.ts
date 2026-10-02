import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { Roles } from '../src/common/decorators/roles.decorator.js';
import { hashToken } from '../src/modules/auth/refresh-token.js';
import { hashPassword } from '../src/modules/auth/scrypt.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  resetThrottler,
  truncateAll,
} from './utils/test-app.js';

const ADMIN = {
  email: 'admin@miwebprofesional.com',
  name: 'Wile',
  password: 'e2e-Admin-Password-123',
};
const EDITOR = {
  email: 'editor@miwebprofesional.com',
  name: 'Editor',
  password: 'e2e-Editor-Password-123',
};
const INACTIVE = {
  email: 'inactive@miwebprofesional.com',
  name: 'Inactive',
  password: 'e2e-Inactive-Password-123',
};

/** Test-only routes to check the global guards on protected endpoints. */
@Controller('test-guards')
class GuardProbeController {
  @Get('any')
  any() {
    return { ok: true };
  }

  @Roles('ADMIN')
  @Get('admin')
  admin() {
    return { ok: true };
  }
}

const AUTH_RESPONSE_KEYS = [
  'accessToken',
  'accessTokenExpiresIn',
  'refreshToken',
  'refreshTokenExpiresAt',
  'user',
].sort();

describe('Auth (e2e, real database)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let hashes: Record<string, string>;
  const http = () => request(app.getHttpServer());

  const login = (email: string, password: string) =>
    http().post('/api/v1/auth/login').send({ email, password });

  beforeAll(async () => {
    app = await createTestApp([GuardProbeController]);
    prisma = app.get(PrismaService);
    // Hash once; scrypt is deliberately slow.
    hashes = {
      admin: await hashPassword(ADMIN.password),
      editor: await hashPassword(EDITOR.password),
      inactive: await hashPassword(INACTIVE.password),
    };
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    resetThrottler(app);
    await prisma.user.createMany({
      data: [
        {
          email: ADMIN.email,
          name: ADMIN.name,
          role: 'ADMIN',
          passwordHash: hashes.admin,
        },
        {
          email: EDITOR.email,
          name: EDITOR.name,
          role: 'EDITOR',
          passwordHash: hashes.editor,
        },
        {
          email: INACTIVE.email,
          name: INACTIVE.name,
          role: 'ADMIN',
          passwordHash: hashes.inactive,
          isActive: false,
        },
      ],
    });
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns 200 with tokens and the user, and records the login', async () => {
      const res = await login(ADMIN.email, ADMIN.password).expect(200);

      expect(Object.keys(res.body).sort()).toEqual(AUTH_RESPONSE_KEYS);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.accessTokenExpiresIn).toBe(900);
      expect(res.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(new Date(res.body.refreshTokenExpiresAt).toISOString()).toBe(
        res.body.refreshTokenExpiresAt,
      );
      expect(res.body.user).toEqual({
        id: expect.any(String),
        email: ADMIN.email,
        name: ADMIN.name,
        role: 'ADMIN',
      });

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: ADMIN.email },
      });
      expect(user.lastLoginAt).toBeInstanceOf(Date);

      // Only the hash of the refresh token is stored, with the client data.
      const session = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashToken(res.body.refreshToken) },
      });
      expect(session).toMatchObject({ userId: user.id, revokedAt: null });
      expect(session.ip).toEqual(expect.any(String));
    });

    it('accepts the email in any case', async () => {
      await login('  ADMIN@MiWebProfesional.com ', ADMIN.password).expect(200);
    });

    it.each([
      ['a wrong password', ADMIN.email, 'wrong-password'],
      ['an unknown email', 'nobody@miwebprofesional.com', ADMIN.password],
      ['an inactive user', INACTIVE.email, INACTIVE.password],
    ])(
      'returns 401 "Credenciales inválidas" for %s',
      async (_, email, password) => {
        const res = await login(email, password).expect(401);

        expect(res.body).toMatchObject({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Credenciales inválidas',
          path: '/api/v1/auth/login',
        });
        expect(res.body).not.toHaveProperty('accessToken');
      },
    );

    it('returns 400 for an invalid body', async () => {
      const extra = await http()
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password, role: 'ADMIN' })
        .expect(400);
      expect(extra.body.message).toContain('property role should not exist');

      const missing = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email' })
        .expect(400);
      expect(missing.body.message).toEqual(
        expect.arrayContaining([
          'email must be an email',
          'password should not be empty',
        ]),
      );
    });

    it('returns 429 after 5 attempts per minute from the same IP', async () => {
      for (let i = 0; i < 5; i++) {
        await login(ADMIN.email, `wrong-${i}`).expect(401);
      }

      const res = await login(ADMIN.email, ADMIN.password).expect(429);

      expect(res.body).toMatchObject({
        statusCode: 429,
        error: 'Too Many Requests',
        message:
          'Demasiados intentos de inicio de sesión. Inténtalo de nuevo en un minuto.',
        path: '/api/v1/auth/login',
      });
      expect(res.headers['retry-after']).toEqual(expect.any(String));
    });

    it('does not rate limit the other auth routes', async () => {
      for (let i = 0; i < 7; i++) {
        await http()
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: `unknown-${i}` })
          .expect(401);
      }
    });
  });

  it('full flow: login → me → refresh → me → reuse → logout', async () => {
    const first = (await login(ADMIN.email, ADMIN.password).expect(200)).body;

    const me = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(200);
    expect(me.body).toEqual(first.user);

    const second = (
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200)
    ).body;
    expect(Object.keys(second).sort()).toEqual(AUTH_RESPONSE_KEYS);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.user).toEqual(first.user);

    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .expect(200, first.user);

    // Rotation: the old token is revoked and points to its replacement.
    const oldRow = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(first.refreshToken) },
    });
    const newRow = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(second.refreshToken) },
    });
    expect(oldRow.revokedAt).toBeInstanceOf(Date);
    expect(oldRow.replacedById).toBe(newRow.id);

    // Reusing the old token is treated as theft: 401 and every session revoked.
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    const active = await prisma.refreshToken.count({
      where: { userId: first.user.id, revokedAt: null },
    });
    expect(active).toBe(0);

    await http()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: second.refreshToken })
      .expect(204);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(401);
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('returns 401 for an unknown token', async () => {
      const res = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'does-not-exist' })
        .expect(401);
      expect(res.body).toMatchObject({
        statusCode: 401,
        error: 'Unauthorized',
      });
    });

    it('returns 401 for an expired token', async () => {
      const { body } = await login(ADMIN.email, ADMIN.password).expect(200);
      await prisma.refreshToken.update({
        where: { tokenHash: hashToken(body.refreshToken) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(401);
    });

    it('returns 400 without a refreshToken', async () => {
      await http().post('/api/v1/auth/refresh').send({}).expect(400);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('returns 204, revokes the token and is idempotent', async () => {
      const { body } = await login(ADMIN.email, ADMIN.password).expect(200);

      await http()
        .post('/api/v1/auth/logout')
        .send({ refreshToken: body.refreshToken })
        .expect(204, '');
      await http()
        .post('/api/v1/auth/logout')
        .send({ refreshToken: body.refreshToken })
        .expect(204);
      await http()
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'never-issued' })
        .expect(204);

      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(401);
    });

    it('returns 400 for an invalid body', async () => {
      await http()
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'x', extra: true })
        .expect(400);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it.each([
      ['no Authorization header', undefined],
      ['a malformed header', 'Token abc'],
      ['an invalid token', 'Bearer not-a-jwt'],
    ])('returns 401 with %s', async (_, header) => {
      const req = http().get('/api/v1/auth/me');
      if (header) req.set('Authorization', header);

      const res = await req.expect(401);
      expect(res.body).toMatchObject({
        statusCode: 401,
        path: '/api/v1/auth/me',
      });
    });

    it('returns 401 when the user was deactivated after login', async () => {
      const { body } = await login(EDITOR.email, EDITOR.password).expect(200);
      await prisma.user.update({
        where: { email: EDITOR.email },
        data: { isActive: false },
      });

      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(401);
    });
  });

  describe('global guards', () => {
    it('keeps @Public() routes public', async () => {
      await http().get('/api/v1/health').expect(200);
    });

    it('protects every other route by default (401 without a token)', async () => {
      await http().get('/api/v1/test-guards/any').expect(401);
    });

    it('enforces @Roles(): 403 for an editor, 200 for an admin', async () => {
      const editor = (await login(EDITOR.email, EDITOR.password).expect(200))
        .body;
      const admin = (await login(ADMIN.email, ADMIN.password).expect(200)).body;

      await http()
        .get('/api/v1/test-guards/any')
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .expect(200);
      const forbidden = await http()
        .get('/api/v1/test-guards/admin')
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .expect(403);
      expect(forbidden.body).toMatchObject({
        statusCode: 403,
        error: 'Forbidden',
      });
      await http()
        .get('/api/v1/test-guards/admin')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
    });
  });
});
