import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import type { User } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { UsersService } from '../users/users.service.js';
import {
  AuthService,
  INVALID_CREDENTIALS,
  INVALID_REFRESH_TOKEN,
} from './auth.service.js';
import type { AccessTokenPayload } from './entities/auth-response.entity.js';
import type { PasswordService } from './password.service.js';
import { hashToken } from './refresh-token.js';

const SECRET = 'unit-test-secret-unit-test-secret-1234';
const DAY_MS = 24 * 60 * 60 * 1000;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'admin@miwebprofesional.com',
    name: 'Wile',
    role: 'ADMIN',
    passwordHash: 'scrypt$stored',
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  const refreshToken = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  const prisma = {
    refreshToken,
    $transaction: vi.fn(),
  };
  const users = {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    recordLogin: vi.fn(),
  };
  const passwords = {
    hash: vi.fn(),
    verify: vi.fn(),
    needsRehash: vi.fn(),
  };
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { algorithm: 'HS256', expiresIn: 900 },
  });
  const config = {
    get: (key: keyof Env) =>
      ({ JWT_ACCESS_TTL_SECONDS: 900, REFRESH_TOKEN_TTL_DAYS: 7 })[
        key as string
      ],
  } as unknown as ConfigService<Env, true>;

  let service: AuthService;
  let createdIds: number;

  beforeEach(() => {
    vi.resetAllMocks();
    createdIds = 0;
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    refreshToken.create.mockImplementation(() =>
      Promise.resolve({ id: `rt-new-${++createdIds}` }),
    );
    passwords.hash.mockResolvedValue('scrypt$dummy');
    passwords.needsRehash.mockReturnValue(false);
    service = new AuthService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      passwords as unknown as PasswordService,
      jwt,
      config,
    );
  });

  describe('login', () => {
    it('returns the tokens and the public user, and records the login', async () => {
      const user = makeUser();
      users.findByEmail.mockResolvedValue(user);
      passwords.verify.mockResolvedValue(true);

      const before = Date.now();
      const result = await service.login(user.email, 'right-password', {
        ip: '127.0.0.1',
        userAgent: 'vitest',
      });

      expect(result.user).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        role: 'ADMIN',
      });
      expect(result).not.toHaveProperty('user.passwordHash');
      expect(result.accessTokenExpiresIn).toBe(900);
      expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const expiresAt = new Date(result.refreshTokenExpiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);

      const claims = await jwt.verifyAsync<
        AccessTokenPayload & { exp: number; iat: number }
      >(result.accessToken);
      expect(claims).toMatchObject({
        sub: user.id,
        email: user.email,
        role: 'ADMIN',
      });
      expect(claims.exp - claims.iat).toBe(900);

      // Only the sha256 of the refresh token is stored.
      expect(refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: user.id,
          tokenHash: hashToken(result.refreshToken),
          expiresAt: expect.any(Date),
          ip: '127.0.0.1',
          userAgent: 'vitest',
        },
        select: { id: true },
      });
      expect(users.recordLogin).toHaveBeenCalledWith(user.id, undefined);
    });

    it('upgrades a hash made with older parameters', async () => {
      users.findByEmail.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(true);
      passwords.needsRehash.mockReturnValue(true);
      passwords.hash.mockResolvedValue('scrypt$upgraded');

      await service.login('admin@miwebprofesional.com', 'right-password');

      expect(users.recordLogin).toHaveBeenCalledWith(
        'user-1',
        'scrypt$upgraded',
      );
    });

    it('rejects a wrong password with 401 "Credenciales inválidas"', async () => {
      users.findByEmail.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(false);

      await expect(
        service.login('admin@miwebprofesional.com', 'wrong'),
      ).rejects.toThrow(new UnauthorizedException(INVALID_CREDENTIALS));
      expect(refreshToken.create).not.toHaveBeenCalled();
      expect(users.recordLogin).not.toHaveBeenCalled();
    });

    it('rejects an unknown email the same way, after checking a dummy hash', async () => {
      users.findByEmail.mockResolvedValue(null);
      passwords.verify.mockResolvedValue(false);

      await expect(
        service.login('nobody@example.com', 'whatever'),
      ).rejects.toThrow(new UnauthorizedException(INVALID_CREDENTIALS));
      expect(passwords.verify).toHaveBeenCalledWith('whatever', 'scrypt$dummy');
      expect(refreshToken.create).not.toHaveBeenCalled();

      // The dummy hash is computed once and reused.
      await expect(service.login('other@example.com', 'x')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(passwords.hash).toHaveBeenCalledTimes(1);
    });

    it('precomputes the dummy hash at startup', async () => {
      await service.onModuleInit();
      expect(passwords.hash).toHaveBeenCalledTimes(1);

      users.findByEmail.mockResolvedValue(null);
      passwords.verify.mockResolvedValue(false);
      await expect(service.login('nobody@example.com', 'x')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(passwords.hash).toHaveBeenCalledTimes(1);
    });

    it('rejects an inactive user even with the right password', async () => {
      users.findByEmail.mockResolvedValue(makeUser({ isActive: false }));
      passwords.verify.mockResolvedValue(true);

      await expect(
        service.login('admin@miwebprofesional.com', 'right-password'),
      ).rejects.toThrow(new UnauthorizedException(INVALID_CREDENTIALS));
      expect(passwords.verify).toHaveBeenCalled();
      expect(refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const presented = 'presented-refresh-token';

    function storedToken(overrides: Record<string, unknown> = {}) {
      return {
        id: 'rt-old',
        userId: 'user-1',
        tokenHash: hashToken(presented),
        expiresAt: new Date(Date.now() + DAY_MS),
        revokedAt: null,
        replacedById: null,
        user: makeUser(),
        ...overrides,
      };
    }

    it('rotates the token: revokes the old one and links it to the new one', async () => {
      refreshToken.findUnique.mockResolvedValue(storedToken());
      refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refresh(presented, { ip: '10.0.0.1' });

      expect(refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hashToken(presented) },
        include: { user: true },
      });
      expect(refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-old', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(refreshToken.create).toHaveBeenCalledTimes(1);
      expect(refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-old' },
        data: { replacedById: 'rt-new-1' },
      });
      expect(result.refreshToken).not.toBe(presented);
      expect(result.user.id).toBe('user-1');
      await expect(jwt.verifyAsync(result.accessToken)).resolves.toMatchObject({
        sub: 'user-1',
      });
    });

    it('treats reuse of a revoked token as theft: revokes all sessions and returns 401', async () => {
      refreshToken.findUnique.mockResolvedValue(
        storedToken({ revokedAt: new Date(), replacedById: 'rt-next' }),
      );
      refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.refresh(presented)).rejects.toThrow(
        new UnauthorizedException(INVALID_REFRESH_TOKEN),
      );
      expect(refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(refreshToken.create).not.toHaveBeenCalled();
    });

    it('handles a concurrent rotation of the same token as reuse', async () => {
      refreshToken.findUnique.mockResolvedValue(storedToken());
      refreshToken.updateMany
        .mockResolvedValueOnce({ count: 0 }) // someone else rotated it first
        .mockResolvedValueOnce({ count: 1 });

      await expect(service.refresh(presented)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshToken.create).not.toHaveBeenCalled();
      expect(refreshToken.updateMany).toHaveBeenLastCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects an expired token with 401 without rotating', async () => {
      refreshToken.findUnique.mockResolvedValue(
        storedToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.refresh(presented)).rejects.toThrow(
        new UnauthorizedException(INVALID_REFRESH_TOKEN),
      );
      expect(refreshToken.updateMany).not.toHaveBeenCalled();
      expect(refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown token with 401', async () => {
      refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('unknown')).rejects.toThrow(
        new UnauthorizedException(INVALID_REFRESH_TOKEN),
      );
      expect(refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects the token of a deactivated user and revokes their sessions', async () => {
      refreshToken.findUnique.mockResolvedValue(
        storedToken({ user: makeUser({ isActive: false }) }),
      );
      refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.refresh(presented)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes the token by its hash', async () => {
      refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('some-token');

      expect(refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: hashToken('some-token'), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('is idempotent: unknown or already revoked tokens do not fail', async () => {
      refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.logout('unknown')).resolves.toBeUndefined();
      await expect(service.logout('unknown')).resolves.toBeUndefined();
    });
  });

  describe('me', () => {
    it('returns the public user', async () => {
      users.findById.mockResolvedValue(makeUser());

      await expect(service.me('user-1')).resolves.toEqual({
        id: 'user-1',
        email: 'admin@miwebprofesional.com',
        name: 'Wile',
        role: 'ADMIN',
      });
    });

    it('returns 401 for a missing or inactive user', async () => {
      users.findById.mockResolvedValueOnce(null);
      await expect(service.me('gone')).rejects.toThrow(UnauthorizedException);

      users.findById.mockResolvedValueOnce(makeUser({ isActive: false }));
      await expect(service.me('user-1')).rejects.toThrow(UnauthorizedException);
    });
  });
});
