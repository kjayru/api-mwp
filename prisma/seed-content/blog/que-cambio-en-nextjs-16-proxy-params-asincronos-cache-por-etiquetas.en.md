---
title: "What changed in Next.js 16: proxy.ts, async params and tag-based caching"
slug: "what-changed-in-nextjs-16-proxy-async-params-tag-caching"
excerpt: "What we learned building miwebprofesional on Next.js 16: proxy.ts instead of middleware, async request APIs, revalidateTag with a profile, ViewTransition, and a 404 that answered 200."
seoTitle: "Next.js 16: proxy.ts, async params and tag-based caching"
seoDescription: "middleware.ts becomes proxy.ts, params and cookies() go async, revalidateTag needs a profile, and a loading.tsx can turn your 404 into a 200."
technologies: ["nextjs", "react"]
publishedAt: "2026-09-05"
---

We built both the public site and the admin panel of miwebprofesional on Next.js 16. Some of this release's changes are a codemod away, while others make you rethink things. These are the ones that affected us most, checked against the official docs for the installed version, plus a lesson we learned from a 404 that wasn't really a 404.

## `middleware.ts` is now `proxy.ts`

The `middleware` convention is deprecated and renamed to `proxy`. The file is `proxy.ts`, and the exported function is `proxy`. The rename isn't purely cosmetic. Proxy runs on the Node.js runtime, and that can't be changed: export a `runtime` option and Next throws. If you need to stay on `edge`, keep using `middleware` for now.

On the public site we use it for exactly one job: redirecting to `/es` or `/en` based on `Accept-Language` when the URL has no locale.

```ts
import { NextResponse, type NextRequest } from "next/server";

import { isLocale, matchLocale } from "@/lib/i18n";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const firstSegment = pathname.split("/")[1];
  if (isLocale(firstSegment)) return;

  const locale = matchLocale(request.headers.get("accept-language"));
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;

  const response = NextResponse.redirect(url);
  // The target depends on the request language: keep shared caches from mixing them up.
  response.headers.set("Vary", "Accept-Language");
  return response;
}

export const config = {
  matcher: ["/((?!_next/|api/|api$|favicon\\.ico).*)"],
};
```

The `Vary: Accept-Language` header is worth copying. Without it, a CDN could cache the redirect to `/es` and serve it to an English-speaking visitor. Config flags with "middleware" in their name were renamed too. For example, `skipMiddlewareUrlNormalize` is now `skipProxyUrlNormalize`.

## `params`, `searchParams`, `cookies()` and `headers()` are async

Next 15 introduced async request APIs but kept a temporary synchronous fallback. **Next 16 removes it.** `cookies()`, `headers()`, `draftMode()`, `params` in layouts, pages and route handlers, and `searchParams` in pages can only be read with `await`.

We type them with the global `PageProps` and `LayoutProps` helpers, which Next generates from the project's routes:

```tsx
export default async function CasePage({ params }: PageProps<"/[lang]/casos/[slug]">) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();

  const [dict, caseData] = await Promise.all([getDictionary(lang), getCase(lang, slug)]);
  // ...
}
```

Passing the route literal gives you typed `slug` and `lang` without declaring anything by hand. In the admin panel, reading the session is async too:

```ts
const cookieStore = await cookies();
const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
```

If your code still relies on the synchronous access that Next 15 tolerated, the `next-async-request-api` codemod does most of the work. Be aware that the general upgrade codemod for 16 doesn't run it for you.

## Tag-based caching and `revalidateTag(tag, profile)`

In Next 16, `fetch` isn't cached by default: caching is opt-in. Our API client turns it on explicitly and tags every response:

```ts
response = await fetch(url, {
  headers: { Accept: "application/json" },
  cache: "force-cache",
  next: { revalidate: REVALIDATE_SECONDS, tags },
});
```

The tags describe content: `cases`, one `case:my-case` tag per case, `services`, `technologies`, `stats`. When someone edits a case in the admin panel, the API calls a webhook on the front end with the affected tags, and the front end invalidates them. The one-hour `revalidate` is only a safety net in case a webhook call gets lost.

The important change is in `revalidateTag`: **it now takes a second argument**, either a `cacheLife` profile or an object with `expire`. The single-argument form is deprecated and fails type-checking. The docs recommend `"max"`, which marks data as stale and keeps serving the old version while it regenerates (stale-while-revalidate). That's ideal for a product catalog. Our editors, though, expect to see their change on the very next visit, not the one after. So the webhook uses `{ expire: 0 }`:

```ts
// The webhook follows an admin edit, so expire immediately: the next visit renders fresh
// content instead of being served the stale page once.
for (const tag of tags) revalidateTag(tag, { expire: 0 });

return Response.json({ revalidated: tags, now: Date.now() });
```

With `expire: 0`, stale content is never served, and the next request waits for fresh data. Next 16 also adds `updateTag`, which gives the same read-your-writes behavior but only works inside Server Actions. Our invalidation comes from another service into a Route Handler, and for that case the docs point to `revalidateTag(tag, { expire: 0 })`.

Before it touches the cache, the webhook compares the shared secret in constant time (`timingSafeEqual` over hashes) and checks that the body is `{ tags: string[] }`.

## Page transitions with `ViewTransition`

The Next 16 App Router ships React 19.2, which includes the `ViewTransition` component on top of the browser's View Transitions API, with no extra configuration. Router navigations are already transitions, so the animations kick in on their own.

To animate every page change, we wrap the content with a per-route `key`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { ViewTransition, type ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <ViewTransition key={pathname} enter="page-enter" exit="page-exit" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
```

The animations live in CSS (`::view-transition-old(.page-exit)` and `::view-transition-new(.page-enter)`) and switch off under `prefers-reduced-motion`. Case covers also get a shared `name` with `share="morph"`, so the image in the listing flies into the header of the detail page. One tip from the docs: if you add `default="none"` to a named pair, keep the explicit `share`, or the morph silently stops working.

## The lesson: a `loading.tsx` that turned our 404 into a 200

This one isn't in the migration guide. A case detail page calls `notFound()` when the API answers 404. The "not found" page rendered fine, but the HTTP status was **200**.

Streaming was the cause. A `loading.tsx` creates a Suspense boundary, and once its fallback renders, the response starts streaming, so the headers, including the status code, are already on the wire. When the page then calls `notFound()`, Next can no longer change that 200. Next does add `noindex` to the HTML, so the page won't be indexed, but monitoring tools and strict crawlers still see a soft 404.

The `loading.tsx` reference spells it out: if you need a real 404, make sure the resource exists before streaming starts. We fixed it with folder structure, using a route group:

- `app/[lang]/(with-loading)/loading.tsx`: the loading state;
- `app/[lang]/(with-loading)/page.tsx`, `casos/page.tsx` and `servicios/page.tsx`: the listings, which do benefit from `loading`;
- `app/[lang]/casos/[slug]/page.tsx`: the detail page, **outside** the group.

Parenthesized groups don't appear in the URL, so `/es/casos` and `/es/casos/my-case` look exactly the same as before, but only the listings sit under `loading.tsx`. The detail page now answers a real 404. It's a project rule now: any page that may call `notFound()` lives outside `(with-loading)`.

## Turbopack by default

Turbopack is stable and is now the default bundler for both `next dev` and `next build`, so `--turbopack` is no longer needed. If a project has a custom `webpack` config (or a plugin adds one), `next build` fails rather than silently ignoring it. You can then migrate to the `turbopack` options or opt out with `--webpack`. Our `package.json` scripts are back to a plain `"build": "next build"`.

## In short

- `middleware.ts` becomes `proxy.ts`, with a `proxy` function that always runs on the Node.js runtime.
- `params`, `searchParams`, `cookies()` and `headers()` only work with `await`, and `PageProps` types them.
- `revalidateTag` requires a profile: `"max"` for stale-while-revalidate, `{ expire: 0 }` when a webhook must expire data right away.
- React 19.2's `ViewTransition` gives you page transitions and morphs with no extra library.
- A `loading.tsx` above a page that calls `notFound()` makes it answer 200, so move those pages out of the group.
- Turbopack is the default bundler.

Migrating to Next.js 16, or starting something new on it? We've already been through these changes at MWP and are happy to help. The official guide is [upgrading to version 16](https://nextjs.org/docs/app/guides/upgrading/version-16).
