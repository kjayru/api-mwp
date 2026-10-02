import type { Request } from 'express';
import type { UserRole } from '../../generated/prisma/enums.js';

/** Identity taken from a verified access token, attached to `request.user`. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
