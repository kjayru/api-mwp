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

/** User as listed in the admin (docs/API.md 11.6). Never includes the password hash. */
export interface AdminUser extends PublicUser {
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toAdminUser(user: User): AdminUser {
  return {
    ...toPublicUser(user),
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
