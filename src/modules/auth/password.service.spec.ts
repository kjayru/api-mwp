import { PasswordService } from './password.service.js';
import { hashPassword } from './scrypt.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with the scrypt$N$r$p$salt$hash format', async () => {
    const hash = await service.hash('correct horse battery staple');

    const parts = hash.split('$');
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 4)).toEqual(['scrypt', '32768', '8', '1']);
    expect(Buffer.from(parts[4], 'base64url')).toHaveLength(16);
    expect(Buffer.from(parts[5], 'base64url')).toHaveLength(64);
    expect(hash).not.toContain('correct horse');
  });

  it('uses a random salt per password', async () => {
    const [a, b] = await Promise.all([
      service.hash('same-password'),
      service.hash('same-password'),
    ]);

    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await service.hash('s3cret-Passw0rd');

    await expect(service.verify('s3cret-Passw0rd', hash)).resolves.toBe(true);
    await expect(service.verify('s3cret-passw0rd', hash)).resolves.toBe(false);
    await expect(service.verify('', hash)).resolves.toBe(false);
  });

  it('verifies hashes made with other parameters (read from the hash)', async () => {
    const legacy = await hashPassword('old-password', {
      N: 2 ** 14,
      r: 8,
      p: 1,
    });

    await expect(service.verify('old-password', legacy)).resolves.toBe(true);
    expect(service.needsRehash(legacy)).toBe(true);
    expect(service.needsRehash(await service.hash('new-password'))).toBe(false);
  });

  it.each([
    '',
    'not-a-hash',
    'bcrypt$32768$8$1$c2FsdA$aGFzaA',
    'scrypt$1000$8$1$c2FsdA$aGFzaA', // N not a power of two
    'scrypt$1073741824$8$1$c2FsdA$aGFzaA', // N too large
    'scrypt$32768$8$1$$aGFzaA', // empty salt
  ])('returns false for a malformed hash: %j', async (stored) => {
    await expect(service.verify('anything', stored)).resolves.toBe(false);
  });
});
