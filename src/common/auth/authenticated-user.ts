import type { Request } from 'express';
import type { UserRole } from '../../generated/prisma/enums.js';

/** Identity taken from a verified access token, attached to `request.user`. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  /** Refresh token id of the session (`sid` claim), when the token has one. */
  sessionId?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
