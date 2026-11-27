/**
 * Per-IP limits of the auth routes that use ThrottlerGuard explicitly (there is
 * no global throttler: the front's server-side fetches share one IP). Each
 * route has its own counter.
 */

/** POST /auth/refresh: more generous, the front refreshes in the background. */
export const REFRESH_THROTTLE = { ttl: 60_000, limit: 30 } as const;

/** POST /auth/password: a logged-in user guessing the current password. */
export const PASSWORD_THROTTLE = { ttl: 60_000, limit: 5 } as const;
