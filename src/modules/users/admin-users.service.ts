import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ListResponse } from '../../common/pagination/pagination.js';
import { isUniqueViolation } from '../../common/prisma-errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PasswordService } from '../auth/password.service.js';
import type { CreateUserDto, UpdateUserDto } from './dto/user.dto.js';
import { type AdminUser, toAdminUser } from './entities/user.entity.js';
import { UsersService } from './users.service.js';

export const USER_NOT_FOUND = 'Usuario no encontrado';

export function emailTaken(): ConflictException {
  return new ConflictException({
    message: 'Ya existe un usuario con ese email',
    error: 'Conflict',
    details: { reason: 'email_taken' },
  });
}

export function selfChange(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    message: 'No puedes cambiar tu propio rol ni desactivar tu propia cuenta',
    error: 'Unprocessable Entity',
    details: { reason: 'self_change' },
  });
}

export function lastAdmin(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    message: 'Debe quedar al menos un administrador activo',
    error: 'Unprocessable Entity',
    details: { reason: 'last_admin' },
  });
}

/** Write conflict of a Serializable transaction (two admins editing at once). */
function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2034'
  );
}

/** Admin user management (docs/API.md 11.6). Users are never deleted. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
  ) {}

  async list(): Promise<ListResponse<AdminUser>> {
    const rows = await this.prisma.user.findMany({
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });
    return { data: rows.map(toAdminUser) };
  }

  async create(dto: CreateUserDto): Promise<AdminUser> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) throw emailTaken();
    const passwordHash = await this.passwords.hash(dto.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          role: dto.role,
          passwordHash,
        },
      });
      return toAdminUser(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw emailTaken();
      throw error;
    }
  }

  /**
   * Name, role and isActive. An admin cannot change their own role or
   * deactivate themselves (self_change), and there must always be at least
   * one active ADMIN (last_admin). Deactivating revokes every session.
   */
  async update(
    callerId: string,
    id: string,
    dto: UpdateUserDto,
  ): Promise<AdminUser> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.applyUpdate(tx, callerId, id, dto),
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (attempt < 3 && isSerializationFailure(error)) continue;
        throw error;
      }
    }
  }

  /** Sets a new password and revokes every session of the user. */
  async setPassword(id: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await this.users.revokeSessions(id, undefined, tx);
    });
  }

  private async applyUpdate(
    tx: Prisma.TransactionClient,
    callerId: string,
    id: string,
    dto: UpdateUserDto,
  ): Promise<AdminUser> {
    const target = await tx.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException(USER_NOT_FOUND);

    const role = dto.role ?? target.role;
    const isActive = dto.isActive ?? target.isActive;
    const changesRole = role !== target.role;
    const changesActive = isActive !== target.isActive;
    if (id === callerId && (changesRole || changesActive)) throw selfChange();

    const wasActiveAdmin = target.role === 'ADMIN' && target.isActive;
    const staysActiveAdmin = role === 'ADMIN' && isActive;
    if (wasActiveAdmin && !staysActiveAdmin) {
      const others = await tx.user.count({
        where: { role: 'ADMIN', isActive: true, id: { not: id } },
      });
      if (others === 0) throw lastAdmin();
    }

    const user = await tx.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        role,
        isActive,
      },
    });
    if (changesActive && !isActive) {
      await this.users.revokeSessions(id, undefined, tx);
    }
    return toAdminUser(user);
  }
}
