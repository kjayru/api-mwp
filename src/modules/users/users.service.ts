import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Emails are stored lowercase; every lookup normalises its input the same way. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async recordLogin(id: string, newPasswordHash?: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: {
        lastLoginAt: new Date(),
        ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}),
      },
    });
  }

  /**
   * Revokes every active refresh token (session) of the user, except
   * `keepId` when given. Returns how many were revoked.
   */
  async revokeSessions(
    userId: string,
    keepId?: string,
    db: Db = this.prisma,
  ): Promise<number> {
    const { count } = await db.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(keepId ? { id: { not: keepId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return count;
  }
}
