import type { UserRole } from '../../../generated/prisma/enums.js';
import type { PublicUser } from '../../users/entities/user.entity.js';

/** Claims of the access token (JWT, HS256). */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

/** Response of POST /auth/login and POST /auth/refresh. */
export interface AuthResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  accessTokenExpiresIn: number;
  refreshToken: string;
  /** ISO 8601 date. */
  refreshTokenExpiresAt: string;
  user: PublicUser;
}

/** Client data stored with each refresh token (session). */
export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}
