import type { User, UserRole } from '../../../generated/prisma/client.js';

/** User as exposed by the API: never includes the password hash. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
