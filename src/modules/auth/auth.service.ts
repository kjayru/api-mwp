import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user.js';
import type { Env } from '../../config/env.js';
import type { Prisma, User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  type PublicUser,
  toPublicUser,
} from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import type {
  AccessTokenPayload,
  AuthResponse,
  SessionMeta,
} from './entities/auth-response.entity.js';
import { PasswordService } from './password.service.js';
import { generateRefreshToken, hashToken } from './refresh-token.js';

export const INVALID_CREDENTIALS = 'Credenciales inválidas';
export const INVALID_REFRESH_TOKEN = 'Sesión inválida o expirada';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_USER_AGENT_LENGTH = 512;
/** Refreshes followed from the session of an access token to the current one. */
const MAX_ROTATION_HOPS = 20;

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlDays: number;
  /** Hash compared against for unknown emails, so they take as long as wrong passwords. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtlSeconds = config.get('JWT_ACCESS_TTL_SECONDS', {
      infer: true,
    });
    this.refreshTtlDays = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
  }

  /** Precomputes the dummy hash so the first unknown-email login is not slower. */
  async onModuleInit(): Promise<void> {
    await this.getDummyHash();
  }

  async login(
    email: string,
    password: string,
    meta: SessionMeta = {},
  ): Promise<AuthResponse> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      await this.passwords.verify(password, await this.getDummyHash());
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const valid = await this.passwords.verify(password, user.passwordHash);
    if (!valid || !user.isActive) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // Transparently upgrade hashes made with older scrypt parameters.
    const upgradedHash = this.passwords.needsRehash(user.passwordHash)
      ? await this.passwords.hash(password)
      : undefined;
    await this.users.recordLogin(user.id, upgradedHash);

    const { response } = await this.issueSession(this.prisma, user, meta);
    return response;
  }

  /**
   * Rotates a refresh token: the presented token is revoked and linked to its
   * replacement. Presenting a token that was already revoked is treated as theft
   * and revokes every active session of the user.
   */
  async refresh(
    refreshToken: string,
    meta: SessionMeta = {},
  ): Promise<AuthResponse> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!stored) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    if (stored.revokedAt) {
      await this.revokeAllSessions(stored.userId, 'refresh token reuse');
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }
    if (!stored.user.isActive) {
      await this.revokeAllSessions(stored.userId, 'inactive user');
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    const session = await this.prisma.$transaction(
      async (tx) => {
        // Conditional update: if a concurrent request already rotated this token,
        // no row matches and the request is handled as a reuse.
        const { count } = await tx.refreshToken.updateMany({
          where: { id: stored.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (count === 0) {
          return null;
        }
        const issued = await this.issueSession(tx, stored.user, meta);
        await tx.refreshToken.update({
          where: { id: stored.id },
          data: { replacedById: issued.refreshTokenId },
        });
        return issued.response;
      },
      { maxWait: 5_000, timeout: 10_000 },
    );

    if (!session) {
      await this.revokeAllSessions(stored.userId, 'concurrent refresh reuse');
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }
    return session;
  }

  /** Revokes the given refresh token. Idempotent: unknown or revoked tokens are ignored. */
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('No autenticado');
    }
    return toPublicUser(user);
  }

  /**
   * POST /auth/password. Revokes every other session of the user; the calling
   * one (the `sid` of the access token, followed through its rotations) is
   * kept when it is still active. Without it every session is revoked.
   */
  async changePassword(
    caller: AuthenticatedUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findById(caller.id);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('No autenticado');
    }
    if (!(await this.passwords.verify(currentPassword, user.passwordHash))) {
      throw new BadRequestException({
        message: 'La contraseña actual no es correcta',
        error: 'Bad Request',
        details: { reason: 'invalid_password' },
      });
    }
    if (newPassword === currentPassword) {
      throw new BadRequestException({
        message: 'La nueva contraseña debe ser distinta de la actual',
        error: 'Bad Request',
        details: { reason: 'same_password' },
      });
    }
    const passwordHash = await this.passwords.hash(newPassword);
    const keepId = caller.sessionId
      ? await this.currentSession(user.id, caller.sessionId)
      : undefined;
    const revoked = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      return this.users.revokeSessions(user.id, keepId, tx);
    });
    this.logger.log(
      `User ${user.id} changed their password; revoked ${revoked} other session(s)`,
    );
  }

  /**
   * The active refresh token of the session that issued `sessionId`: an
   * access token outlives one refresh, so follow the rotation chain.
   */
  private async currentSession(
    userId: string,
    sessionId: string,
  ): Promise<string | undefined> {
    let id: string | null = sessionId;
    for (let hops = 0; id && hops < MAX_ROTATION_HOPS; hops++) {
      const token: {
        id: string;
        userId: string;
        revokedAt: Date | null;
        expiresAt: Date;
        replacedById: string | null;
      } | null = await this.prisma.refreshToken.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          revokedAt: true,
          expiresAt: true,
          replacedById: true,
        },
      });
      if (!token || token.userId !== userId) return undefined;
      if (!token.revokedAt) {
        return token.expiresAt.getTime() > Date.now() ? token.id : undefined;
      }
      id = token.replacedById;
    }
    return undefined;
  }

  /** Creates a refresh token row and signs a new access token. */
  private async issueSession(
    db: Db,
    user: User,
    meta: SessionMeta,
  ): Promise<{ response: AuthResponse; refreshTokenId: string }> {
    const { token, tokenHash } = generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.refreshTtlDays * DAY_MS);
    const row = await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, MAX_USER_AGENT_LENGTH),
      },
      select: { id: true },
    });

    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: row.id,
    };
    const response: AuthResponse = {
      accessToken: await this.jwt.signAsync(payload),
      accessTokenExpiresIn: this.accessTtlSeconds,
      refreshToken: token,
      refreshTokenExpiresAt: expiresAt.toISOString(),
      user: toPublicUser(user),
    };
    return { response, refreshTokenId: row.id };
  }

  private async revokeAllSessions(userId: string, reason: string) {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.warn(
      `Revoked ${count} active session(s) of user ${userId}: ${reason}`,
    );
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hash(randomBytes(32).toString('hex'));
    return this.dummyHash;
  }
}
