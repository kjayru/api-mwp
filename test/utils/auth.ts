import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '../../src/generated/prisma/enums.js';
import type { AccessTokenPayload } from '../../src/modules/auth/entities/auth-response.entity.js';

/**
 * Signs an access token like POST /auth/login would. The login flow itself is
 * covered by auth.e2e-spec.ts; signing directly avoids its 5/min rate limit.
 */
export function accessToken(app: INestApplication, role: UserRole): string {
  const payload: AccessTokenPayload = {
    sub: `user-${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@miwebprofesional.com`,
    role,
  };
  return app.get(JwtService).sign(payload);
}

/** `{ Authorization: 'Bearer ...' }` for supertest's `.set()`. */
export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
