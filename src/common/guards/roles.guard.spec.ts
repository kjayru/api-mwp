import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../generated/prisma/enums.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

function contextFor(user?: AuthenticatedUser): ExecutionContext {
  const handler = () => undefined;
  class Controller {}
  return {
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  const admin: AuthenticatedUser = {
    id: 'u1',
    email: 'a@b.com',
    role: 'ADMIN',
  };
  const editor: AuthenticatedUser = {
    id: 'u2',
    email: 'e@b.com',
    role: 'EDITOR',
  };

  function requireRoles(roles: UserRole[] | undefined) {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows any authenticated user when the route has no @Roles()', () => {
    requireRoles(undefined);
    expect(guard.canActivate(contextFor(editor))).toBe(true);

    requireRoles([]);
    expect(guard.canActivate(contextFor(editor))).toBe(true);
  });

  it('reads the metadata from the handler and the class', () => {
    const spy = vi
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(undefined);
    const context = contextFor(admin);

    guard.canActivate(context);

    expect(spy).toHaveBeenCalledWith(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  });

  it('allows a user with one of the required roles', () => {
    requireRoles(['ADMIN']);
    expect(guard.canActivate(contextFor(admin))).toBe(true);

    requireRoles(['ADMIN', 'EDITOR']);
    expect(guard.canActivate(contextFor(editor))).toBe(true);
  });

  it('rejects a user without the required role with 403', () => {
    requireRoles(['ADMIN']);
    expect(() => guard.canActivate(contextFor(editor))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a request without a user with 403', () => {
    requireRoles(['ADMIN']);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
