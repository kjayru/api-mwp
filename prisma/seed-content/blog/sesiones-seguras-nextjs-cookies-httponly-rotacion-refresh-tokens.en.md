---
title: "Secure sessions in Next.js: httpOnly cookies and refresh-token rotation with theft detection"
slug: "secure-sessions-nextjs-httponly-cookies-refresh-token-rotation"
excerpt: "How we protect our admin panel: a 15-minute access token, an opaque refresh token that rotates on every use, httpOnly cookies, a proxy.ts that refreshes without duplicates, and real checks on the server."
seoTitle: "Secure Next.js sessions with refresh-token rotation"
seoDescription: "A 15-min JWT, an opaque refresh token stored as sha256, rotation with reuse detection, httpOnly cookies, deduplicated refresh in proxy.ts, and scrypt passwords."
technologies: ["nextjs", "nestjs", "postgresql"]
publishedAt: "2026-09-14"
---

The miwebprofesional admin panel (Next.js 16) authenticates against our API (NestJS 12 on PostgreSQL). We wanted sessions that last for days without a stolen token being useful for days, and we wanted browser JavaScript to never see a token at all. Here is the design, its code, and the problems we ran into.

## Two tokens, two jobs

| | Access token | Refresh token |
|---|---|---|
| Format | Signed JWT (HS256) | 32 random bytes, base64url (opaque) |
| Lifetime | 15 minutes | 7 days |
| Checked | On every request, by signature | Only on `POST /auth/refresh`, against the database |
| What we store | Nothing | Its sha256 hash, nothing else |

If the access token leaks, it's good for 15 minutes at most. The refresh token isn't a JWT because it carries nothing: it's a random value that only counts if it exists in our table:

```ts
import { createHash, randomBytes } from 'node:crypto';

/** sha256 (hex) of an opaque token. Only this hash is stored in the database. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}
```

A database dump therefore contains no usable sessions. With 256 bits of entropy, a plain sha256 is enough; no slow, password-style hash is needed.

## Rotation and reuse detection

Each time a refresh token is used, it gets revoked and a new one is issued, linked to the old one (`replacedById`). The key rule: **if anyone presents a refresh token that was already revoked, we assume theft and revoke every session the user has.** Someone (the attacker or the user) holds a stale token and we can't tell who, so both sign in again.

```ts
if (stored.revokedAt) {
  await this.revokeAllSessions(stored.userId, 'refresh token reuse');
  throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
}
```

There's a subtle race here. Two requests carrying the same token can both read it as valid at the same moment. That's why revocation is a conditional update inside a transaction. Only one request can win, and the other is treated as reuse:

```ts
const session = await this.prisma.$transaction(async (tx) => {
  // If a concurrent request already rotated this token, no row matches.
  const { count } = await tx.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) {
    return null;
  }
  const issued = await this.issueSession(tx, stored.user, meta);
  await tx.refreshToken.update({
    where: { id: stored.id },
    data: { replacedById: issued.refreshTokenId },
  });
  return issued.response;
});
```

The rule is deliberately strict, and as we'll see, that strictness has a consequence on the client.

## httpOnly cookies: the token never reaches JavaScript

The panel never keeps tokens in `localStorage` or hands them to client components. They travel in `httpOnly` cookies, which the browser sends but page scripts can't read, so an XSS bug can't steal them:

```ts
store.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: tokens.accessTokenExpiresIn,
});
// The refresh token uses the same options, with `expires` set to its expiry date.
```

`sameSite: "lax"` keeps the cookies off cross-site POSTs, and Next's Server Actions already reject cross-origin calls. The helper accepts both `cookies()` in a Server Action and `NextResponse.cookies` in the proxy.

## `proxy.ts`: refresh before expiry

In Next 16 the old middleware is called `proxy.ts`. Ours inspects the cookies on every request. When the access token has less than a minute left, it uses the refresh token to get a new one before the page renders:

```ts
if (hasFreshAccessToken) return NextResponse.next();

if (!refreshToken) {
  return redirectToLogin(request, { clearCookies: accessToken !== undefined });
}

const result = await refreshSession(refreshToken);
if (result.ok) return continueWithTokens(request, result.tokens);
```

The proxy reads the JWT's `exp` claim **without verifying the signature**: the panel doesn't hold the API's secret, and shouldn't. That value only decides when to refresh, never who gets in.

`continueWithTokens` writes the new cookies on the response (for the browser) and on the forwarded request, so Server Components rendering that same request read the new token through `cookies()`.

If the API can't answer (it's down, it timed out, or it returned a 5xx), the proxy does **not** clear the cookies. An outage shouldn't look like a logout.

## Why refreshes must be deduplicated

This is where the API's strict rule sends us the bill. When a user returns to a tab with an expired access token, the browser fires several requests almost at once (the document, RSC prefetches, maybe a Server Action), all carrying **the same** refresh token. If each refreshed on its own, the first would rotate the token, the second would present a revoked one, and the API, doing its job, would end every session.

The fix: concurrent refreshes of the same token share one API call, and a success is reused for a short grace period:

```ts
const GRACE_PERIOD_MS = 20_000;
const recentRefreshes = new Map<string, Entry>();

export function refreshSession(refreshToken: string): Promise<RefreshResult> {
  const now = Date.now();
  pruneExpired(now);

  const existing = recentRefreshes.get(refreshToken);
  if (existing) return existing.promise;

  const promise = performRefresh(refreshToken).then((result) => {
    if (result.ok) {
      recentRefreshes.set(refreshToken, { promise, expiresAt: Date.now() + GRACE_PERIOD_MS });
    } else {
      // Only successes are reused; a failure may be retried by the next request.
      recentRefreshes.delete(refreshToken);
    }
    return result;
  });
  recentRefreshes.set(refreshToken, { promise, expiresAt: Number.POSITIVE_INFINITY });
  return promise;
}
```

The grace period covers requests already in flight with the old cookie. One honest limitation: the map lives in memory, **per process**. With several panel instances, two could still refresh the same token at once; in that setup the API would need to tolerate a short reuse window, which we've noted for when we scale out.

## The proxy doesn't authenticate: the real check is on the server

A request getting past the proxy doesn't mean the user is authenticated: the proxy only ran an optimistic cookie check. The real check lives in a data access layer (DAL) that confirms every session with the API (`GET /auth/me`) and takes the user and role from that response:

```ts
export const getSession = cache(async (): Promise<Session | null> => {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) return null;

  try {
    return { user: await requestMe(accessToken) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
});
```

React's `cache` memoizes the result for the request. Every Server Action that reads or changes data calls `requireUser()`, because it's a public POST endpoint and the layout's check doesn't run for it. And since layouts don't re-render on client-side navigation, data-loading functions call it too.

## scrypt passwords, no native dependencies

On the API side, passwords go through `scrypt` from `node:crypto`, with no packages that compile native code at install time. Each hash is stored together with its parameters:

```ts
/** Returns `scrypt$N$r$p$salt$hash` (salt and hash in base64url). */
export async function hashPassword(password: string, params = DEFAULT_SCRYPT_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, KEY_BYTES, params);
  return [PREFIX, params.N, params.r, params.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}
```

Keeping `N`, `r` and `p` lets us raise the cost later: on a successful login, a hash made with weaker parameters is transparently recomputed. Comparison uses `timingSafeEqual`, and unknown emails are checked against a dummy hash so they take as long and don't reveal which accounts exist.

## Rate-limited login, with a caveat

`POST /auth/login` allows 5 attempts per minute per IP, using `@nestjs/throttler` with in-memory storage. That stops basic brute force, with one well-known trap: behind a reverse proxy, Node sees the proxy's IP, not the client's. Without configuring `trust proxy`, everyone shares one counter and a few failures lock everyone out. That's on our production-hardening list, along with shared storage if the API ever runs on several instances.

## In short

- A 15-minute access JWT plus a 7-day opaque refresh token, stored only as sha256.
- Every refresh rotates the token, and reusing a revoked one ends all of the user's sessions.
- Tokens travel in `httpOnly`, `sameSite: "lax"` cookies and never reach browser JavaScript.
- `proxy.ts` refreshes ahead of expiry and **shares a single refresh** across simultaneous requests. Without that, rotation would log users out.
- The proxy doesn't authenticate: `requireUser()` confirms the session with the API in every Server Action and data load.
- scrypt with its parameters stored in the hash, plus per-IP login limits that take the reverse proxy into account.

If your application needs sessions like these, or you'd like us to review the ones you have, let's talk. For further reading, see the [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication) and the [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
