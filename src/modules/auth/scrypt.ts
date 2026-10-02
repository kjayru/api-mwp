import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Plain functions (no Nest decorators) so prisma/seed.ts can import them when it
// runs with Node's native type stripping. Use PasswordService inside the app.

export interface ScryptParams {
  /** CPU/memory cost, a power of two. */
  N: number;
  /** Block size. */
  r: number;
  /** Parallelization. */
  p: number;
}

/** ~32 MiB and ~50-100 ms per hash on a typical server. */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };

const PREFIX = 'scrypt';
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  { N, r, p }: ScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // scrypt needs 128 * N * r bytes; leave headroom over Node's 32 MiB default.
    const maxmem = 256 * N * r;
    scrypt(password, salt, keyLength, { N, r, p, maxmem }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Returns `scrypt$N$r$p$salt$hash` (salt and hash in base64url). */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, KEY_BYTES, params);
  return [
    PREFIX,
    params.N,
    params.r,
    params.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

function parseHash(
  stored: string,
): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    return null;
  }
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const validParams =
    Number.isInteger(N) &&
    N >= 2 ** 10 &&
    N <= 2 ** 20 &&
    (N & (N - 1)) === 0 &&
    Number.isInteger(r) &&
    r >= 1 &&
    r <= 32 &&
    Number.isInteger(p) &&
    p >= 1 &&
    p <= 16;
  const salt = Buffer.from(parts[4], 'base64url');
  const key = Buffer.from(parts[5], 'base64url');
  if (!validParams || salt.length === 0 || key.length === 0) {
    return null;
  }
  return { params: { N, r, p }, salt, key };
}

/** Constant-time check; returns false (never throws) for malformed hashes. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) {
    return false;
  }
  const key = await deriveKey(
    password,
    parsed.salt,
    parsed.key.length,
    parsed.params,
  );
  return timingSafeEqual(key, parsed.key);
}

/** True when the hash was made with weaker parameters than the current default. */
export function needsRehash(
  stored: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): boolean {
  const parsed = parseHash(stored);
  return (
    !parsed ||
    parsed.params.N < params.N ||
    parsed.params.r < params.r ||
    parsed.params.p < params.p
  );
}
