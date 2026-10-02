import { ConflictException } from '@nestjs/common';

/** Unique constraint violation (P2002), e.g. two concurrent requests taking the same slug. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Turns a unique violation that slipped past the explicit checks (a race) into a
 * 409; rethrows anything else.
 */
export function rethrowUniqueAsConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw new ConflictException(
      'Ya existe un registro con ese valor (slug o nombre duplicado)',
    );
  }
  throw error;
}
