import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { User } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { PasswordService } from '../auth/password.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { UsersService } from './users.service.js';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-admin',
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

const reasonOf = (error: unknown) =>
  (
    (error as UnprocessableEntityException).getResponse() as {
      details: { reason: string };
    }
  ).details.reason;

describe('AdminUsersService', () => {
  const prisma = {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    refreshToken: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const passwords = { hash: vi.fn(async () => 'scrypt$new') };
  const users = new UsersService(prisma as unknown as PrismaService);
  const service = new AdminUsersService(
    prisma as unknown as PrismaService,
    users,
    passwords as unknown as PasswordService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    prisma.user.update.mockImplementation(
      async ({ data }: { data: Partial<User> }) =>
        makeUser({ id: 'target', ...data }),
    );
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
  });

  it('lists users ordered by name without the password hash', async () => {
    prisma.user.findMany.mockResolvedValue([makeUser()]);
    const { data } = await service.list();
    expect(data[0]).not.toHaveProperty('passwordHash');
    expect(data[0]).toMatchObject({ isActive: true, lastLoginAt: null });
    expect(prisma.user.findMany.mock.calls[0][0].orderBy).toEqual([
      { name: 'asc' },
      { email: 'asc' },
    ]);
  });

  it('create hashes the password and answers 409 email_taken for a used email', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.create.mockImplementation(
      async ({ data }: { data: Partial<User> }) =>
        makeUser({ id: 'new', ...data }),
    );
    const created = await service.create({
      email: 'ana@miwebprofesional.com',
      name: 'Ana',
      role: 'EDITOR',
      password: 'a-long-password-123',
    });
    expect(created).toMatchObject({ id: 'new', role: 'EDITOR' });
    expect(prisma.user.create.mock.calls[0][0].data.passwordHash).toBe(
      'scrypt$new',
    );

    prisma.user.findUnique.mockResolvedValueOnce({ id: 'other' });
    const error = await service
      .create({
        email: 'ana@miwebprofesional.com',
        name: 'Ana',
        role: 'EDITOR',
        password: 'x'.repeat(12),
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(reasonOf(error)).toBe('email_taken');
  });

  it('self_change: an admin cannot change their own role or deactivate themselves', async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser());
    for (const dto of [{ role: 'EDITOR' as const }, { isActive: false }]) {
      const error = await service
        .update('u-admin', 'u-admin', dto)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(reasonOf(error)).toBe('self_change');
    }
    // Renaming oneself (or resending the same values) is fine.
    await expect(
      service.update('u-admin', 'u-admin', {
        name: 'Wile R.',
        role: 'ADMIN',
        isActive: true,
      }),
    ).resolves.toBeDefined();
  });

  it('last_admin: the last active ADMIN cannot be demoted or deactivated', async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ id: 'target' }));
    prisma.user.count.mockResolvedValue(0);
    const error = await service
      .update('u-other', 'target', { role: 'EDITOR' })
      .catch((e: unknown) => e);
    expect(reasonOf(error)).toBe('last_admin');
    expect(prisma.user.count.mock.calls[0][0].where).toEqual({
      role: 'ADMIN',
      isActive: true,
      id: { not: 'target' },
    });

    prisma.user.count.mockResolvedValue(1);
    await expect(
      service.update('u-other', 'target', { role: 'EDITOR' }),
    ).resolves.toMatchObject({
      role: 'EDITOR',
    });
  });

  it('deactivating revokes every session; other changes do not', async () => {
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ id: 'target', role: 'EDITOR' }),
    );
    await service.update('u-admin', 'target', { name: 'Otro' });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();

    await service.update('u-admin', 'target', { isActive: false });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'target', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('update and setPassword answer 404 for unknown users', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.update('u-admin', 'nope', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.setPassword('nope', 'x'.repeat(12)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setPassword stores the new hash and revokes every session of the user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target' });
    await service.setPassword('target', 'a-new-password-123');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'target' },
      data: { passwordHash: 'scrypt$new' },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'target', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
