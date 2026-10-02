import { createHash, randomBytes } from 'node:crypto';

/** sha256 (hex) of an opaque token. Only this hash is stored in the database. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 32 random bytes in base64url (43 characters) plus its hash. */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}
