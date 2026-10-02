import type { PrismaService } from '../../prisma/prisma.service.js';
import { toPublicUser } from './entities/user.entity.js';
import { normalizeEmail, UsersService } from './users.service.js';

describe('UsersService', () => {
  const user = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const service = new UsersService({ user } as unknown as PrismaService);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('normalises the email before looking it up', async () => {
    await service.findByEmail('  Admin@MiWebProfesional.com ');

    expect(user.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@miwebprofesional.com' },
    });
  });

  it('records the login time and, if given, the upgraded hash', async () => {
    await service.recordLogin('u1');
    expect(user.update).toHaveBeenLastCalledWith({
      where: { id: 'u1' },
      data: { lastLoginAt: expect.any(Date) },
    });

    await service.recordLogin('u1', 'scrypt$new');
    expect(user.update).toHaveBeenLastCalledWith({
      where: { id: 'u1' },
      data: { lastLoginAt: expect.any(Date), passwordHash: 'scrypt$new' },
    });
  });

  it('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail(' A@B.COM ')).toBe('a@b.com');
  });

  it('toPublicUser never exposes the password hash', () => {
    const publicUser = toPublicUser({
      id: 'u1',
      email: 'a@b.com',
      name: 'A',
      role: 'ADMIN',
      passwordHash: 'scrypt$secret',
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(publicUser).toEqual({
      id: 'u1',
      email: 'a@b.com',
      name: 'A',
      role: 'ADMIN',
    });
  });
});
