import { UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { CurrentUser } from './current-user.decorator.js';

/** Extracts the factory registered by a param decorator. */
function factoryOf() {
  class T {
    handler(@CurrentUser() _u: unknown) {}
  }
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, T, 'handler');
  return Object.values(meta)[0] as {
    factory: (data: unknown, ctx: unknown) => unknown;
  };
}
const ctx = (request: object) => ({
  switchToHttp: () => ({ getRequest: () => request }),
});

describe('CurrentUser', () => {
  it('returns the authenticated user of the request', () => {
    const user = { id: 'u1', role: 'ADMIN' };
    expect(factoryOf().factory(undefined, ctx({ user }))).toBe(user);
  });

  it('throws 401 when the route has no authenticated user', () => {
    expect(() => factoryOf().factory(undefined, ctx({}))).toThrow(
      UnauthorizedException,
    );
  });
});
