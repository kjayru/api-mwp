import { JwtService } from '@nestjs/jwt';
import {
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { BlogService } from '../blog/blog.service.js';
import type { CasesService } from '../cases/cases.service.js';
import {
  PreviewSecretGuard,
  secretsMatch,
} from './preview-secret.guard.js';
import { PreviewService } from './preview.service.js';

const SECRET = 'preview-secret-preview-secret-0123456789';
const FRONT_URL = 'https://miwebprofesional.com';

function setup(secret: string | null = SECRET) {
  const prisma = {
    case: { findFirst: vi.fn() },
    blogPost: { findFirst: vi.fn() },
  };
  const cases = { findBySlug: vi.fn().mockResolvedValue({ slug: 'x' }) };
  const blog = { findBySlug: vi.fn().mockResolvedValue({ slug: 'y' }) };
  const config = {
    get: (key: string) =>
      key === 'PREVIEW_SECRET' ? (secret ?? undefined) : key === 'FRONT_URL' ? FRONT_URL : undefined,
  } as unknown as ConfigService<Env, true>;
  const jwt = new JwtService({});
  const service = new PreviewService(
    prisma as unknown as PrismaService,
    jwt,
    config,
    cases as unknown as CasesService,
    blog as unknown as BlogService,
  );
  return { service, prisma, cases, blog, jwt, config };
}

const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

describe('PreviewService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T17:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('signs a 10 minute HS256 token with audience preview and builds the front URL', async () => {
    const { service, prisma, jwt } = setup();
    prisma.case.findFirst.mockResolvedValue({ translations: [{ slug: 'contaflow-ia' }] });

    const link = await service.createLink({ type: 'case', id: 'c1', locale: 'es' });

    expect(link.expiresAt).toBe('2026-11-27T17:10:00.000Z');
    expect(link.url.startsWith(`${FRONT_URL}/api/draft?token=`)).toBe(true);
    const token = tokenOf(link.url);
    const decoded = jwt.decode(token, { complete: true }) as {
      header: { alg: string };
      payload: Record<string, unknown>;
    };
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload).toMatchObject({
      type: 'case',
      id: 'c1',
      locale: 'es',
      aud: 'preview',
      exp: Date.parse('2026-11-27T17:10:00Z') / 1000,
    });
  });

  it('404 for an unknown or deleted entity, 422 no_slug without a translation', async () => {
    const { service, prisma } = setup();
    prisma.case.findFirst.mockResolvedValue(null);
    await expect(
      service.createLink({ type: 'case', id: 'nope', locale: 'es' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.case.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'nope', deletedAt: null } }),
    );

    prisma.blogPost.findFirst.mockResolvedValue({ translations: [] });
    const error = await service
      .createLink({ type: 'post', id: 'p1', locale: 'en' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      details: { reason: 'no_slug', locale: 'EN' },
    });
  });

  it('503 preview_disabled without PREVIEW_SECRET', async () => {
    const { service } = setup(null);
    const error = await service
      .createLink({ type: 'case', id: 'c1', locale: 'es' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      details: { reason: 'preview_disabled' },
    });
    await expect(service.resolve('whatever')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('resolves a valid token to the current slug of the translation', async () => {
    const { service, prisma } = setup();
    prisma.case.findFirst.mockResolvedValue({ translations: [{ slug: 'contaflow-ia' }] });
    const { url } = await service.createLink({ type: 'case', id: 'c1', locale: 'es' });

    prisma.case.findFirst.mockResolvedValue({ translations: [{ slug: 'contaflow-nuevo' }] });
    await expect(service.resolve(tokenOf(url))).resolves.toEqual({
      type: 'case',
      id: 'c1',
      locale: 'es',
      slug: 'contaflow-nuevo',
    });
  });

  it('401 invalid_token for expired, garbage, other-secret, other-audience and bad payloads', async () => {
    const { service, prisma, jwt } = setup();
    prisma.case.findFirst.mockResolvedValue({ translations: [{ slug: 's' }] });
    const { url } = await service.createLink({ type: 'case', id: 'c1', locale: 'es' });
    const valid = tokenOf(url);

    const forge = (payload: object, options: object) =>
      jwt.sign(payload, { algorithm: 'HS256', ...options });
    const claims = { type: 'case', id: 'c1', locale: 'es' };
    const bad = [
      'garbage',
      forge(claims, { secret: 'x'.repeat(40), audience: 'preview' }),
      forge(claims, { secret: SECRET }),
      forge(claims, { secret: SECRET, audience: 'access' }),
      forge({ type: 'user', id: 'c1', locale: 'es' }, { secret: SECRET, audience: 'preview' }),
      forge({ type: 'case', id: 'c1', locale: 'fr' }, { secret: SECRET, audience: 'preview' }),
      // alg none
      `${Buffer.from('{"alg":"none"}').toString('base64url')}.${valid.split('.')[1]}.`,
    ];
    for (const token of bad) {
      const error = await service.resolve(token).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        details: { reason: 'invalid_token' },
      });
    }

    vi.setSystemTime(new Date('2026-11-27T17:10:01Z'));
    await expect(service.resolve(valid)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('404 when the entity was deleted after the token was issued', async () => {
    const { service, prisma } = setup();
    prisma.blogPost.findFirst.mockResolvedValue({ translations: [{ slug: 's' }] });
    const { url } = await service.createLink({ type: 'post', id: 'p1', locale: 'es' });
    prisma.blogPost.findFirst.mockResolvedValue(null);
    await expect(service.resolve(tokenOf(url))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads drafts through the public builders with includeDrafts', async () => {
    const { service, cases, blog } = setup();
    await service.caseBySlug('es', 'a');
    await service.postBySlug('en', 'b');
    expect(cases.findBySlug).toHaveBeenCalledWith('es', 'a', { includeDrafts: true });
    expect(blog.findBySlug).toHaveBeenCalledWith('en', 'b', { includeDrafts: true });
  });
});

describe('PreviewSecretGuard', () => {
  const context = (header?: unknown) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-preview-secret': header } }),
      }),
    }) as unknown as ExecutionContext;

  it('accepts the exact secret only', () => {
    const { config } = setup();
    const guard = new PreviewSecretGuard(config);
    expect(guard.canActivate(context(SECRET))).toBe(true);
    for (const header of [undefined, '', 'short', `${SECRET}x`, ['a', 'b']]) {
      expect(() => guard.canActivate(context(header))).toThrow(UnauthorizedException);
    }
  });

  it('503 when the secret is not configured', () => {
    const { config } = setup(null);
    expect(() => new PreviewSecretGuard(config).canActivate(context(SECRET))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('compares secrets of different length without throwing', () => {
    expect(secretsMatch('a', 'abcdef')).toBe(false);
    expect(secretsMatch('abcdef', 'abcdef')).toBe(true);
  });
});
