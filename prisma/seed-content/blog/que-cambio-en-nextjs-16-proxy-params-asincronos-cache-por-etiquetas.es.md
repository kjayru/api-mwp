---
title: "Lo que cambió en Next.js 16: proxy.ts, params asíncronos y caché por etiquetas"
slug: "que-cambio-en-nextjs-16-proxy-params-asincronos-cache-por-etiquetas"
excerpt: "Lo que aprendimos al construir miwebprofesional con Next.js 16: proxy.ts en lugar de middleware, APIs de petición asíncronas, revalidateTag con perfil, ViewTransition y un 404 que respondía 200."
seoTitle: "Next.js 16: proxy.ts, APIs asíncronas y caché por etiquetas"
seoDescription: "middleware.ts pasa a proxy.ts, params y cookies() son asíncronos, revalidateTag pide un perfil y un loading.tsx puede convertir tu 404 en un 200."
technologies: ["nextjs", "react"]
publishedAt: "2026-09-05"
---

Construimos el sitio público y el panel de administración de miwebprofesional con Next.js 16. Algunos cambios de esta versión se resuelven con un codemod y otros obligan a repensar cosas. Aquí repasamos los que más nos afectaron, contrastados con la documentación oficial de la versión instalada, y una lección que aprendimos con un 404 que no lo era.

## `middleware.ts` ahora se llama `proxy.ts`

La convención `middleware` quedó obsoleta y pasa a llamarse `proxy`: el archivo es `proxy.ts` y la función exportada es `proxy`. El cambio de nombre no es solo cosmético. El proxy corre en el runtime de Node.js, y ese runtime no se puede cambiar: si exportas `runtime`, Next lanza un error. Quien necesite seguir en `edge` tiene que mantener `middleware` por ahora.

En el sitio público lo usamos para una sola cosa: redirigir a `/es` o `/en` según `Accept-Language` cuando la URL no trae idioma.

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
  // El destino depende del idioma: que las cachés compartidas no los mezclen.
  response.headers.set("Vary", "Accept-Language");
  return response;
}

export const config = {
  matcher: ["/((?!_next/|api/|api$|favicon\\.ico).*)"],
};
```

Un detalle que vale la pena copiar es el `Vary: Accept-Language`: sin él, una CDN podría guardar la redirección a `/es` y servírsela a un visitante en inglés. Las opciones de configuración que llevaban "middleware" en el nombre también cambiaron; por ejemplo, `skipMiddlewareUrlNormalize` ahora es `skipProxyUrlNormalize`.

## `params`, `searchParams`, `cookies()` y `headers()` son asíncronos

Next 15 introdujo las APIs de petición asíncronas, pero mantenía un modo de compatibilidad síncrono. **En Next 16 ese modo desaparece**: `cookies()`, `headers()`, `draftMode()`, los `params` de layouts, páginas y route handlers, y los `searchParams` de las páginas solo se pueden leer con `await`.

Para tiparlos usamos los helpers globales `PageProps` y `LayoutProps`, que Next genera a partir de las rutas del proyecto:

```tsx
export default async function CasePage({ params }: PageProps<"/[lang]/casos/[slug]">) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();

  const [dict, caseData] = await Promise.all([getDictionary(lang), getCase(lang, slug)]);
  // ...
}
```

El literal de la ruta hace que `slug` y `lang` estén tipados sin declararlos a mano. En el panel de administración, leer la sesión también es asíncrono:

```ts
const cookieStore = await cookies();
const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
```

Si tu código todavía usa el acceso síncrono que Next 15 toleraba, el codemod `next-async-request-api` hace la mayor parte del trabajo. Ojo: el codemod general de actualización a la 16 no lo ejecuta.

## Caché por etiquetas y `revalidateTag(tag, perfil)`

En Next 16 el `fetch` no se cachea por defecto: la caché es opcional. Nuestro cliente de la API la activa de forma explícita y etiqueta cada respuesta:

```ts
response = await fetch(url, {
  headers: { Accept: "application/json" },
  cache: "force-cache",
  next: { revalidate: REVALIDATE_SECONDS, tags },
});
```

Las etiquetas describen el contenido: `cases`, `case:mi-caso` (una por caso), `services`, `technologies`, `stats`. Cuando alguien edita un caso en el panel, la API llama a un webhook del front con las etiquetas afectadas, y el front las invalida. El `revalidate` de una hora es solo una red de seguridad por si se pierde una llamada al webhook.

El cambio importante está en `revalidateTag`: **ahora pide un segundo argumento**, un perfil de `cacheLife` o un objeto con `expire`. La forma de un solo argumento está obsoleta y da error de TypeScript. La documentación recomienda `"max"`, que marca los datos como obsoletos y sigue sirviendo la versión anterior mientras se regeneran (*stale-while-revalidate*). Eso es perfecto para un catálogo, pero en nuestro caso quien edita en el panel quiere ver su cambio en la siguiente visita, no en la segunda. Por eso el webhook usa `{ expire: 0 }`:

```ts
// El webhook llega tras una edición en el admin: expiramos de inmediato para que
// la siguiente visita vea el contenido nuevo, sin servir una vez la versión vieja.
for (const tag of tags) revalidateTag(tag, { expire: 0 });

return Response.json({ revalidated: tags, now: Date.now() });
```

Con `expire: 0` nunca se sirve contenido obsoleto: la siguiente petición espera a que los datos se regeneren. Next 16 también trae `updateTag`, que da esa misma semántica de "leer lo que acabas de escribir", pero solo funciona dentro de Server Actions. Como nuestra invalidación llega desde otro servicio a un Route Handler, la documentación indica `revalidateTag(tag, { expire: 0 })`.

El webhook compara el secreto en tiempo constante (con `timingSafeEqual` sobre los hashes) y valida que el cuerpo sea `{ tags: string[] }` antes de tocar la caché.

## Transiciones de página con `ViewTransition`

El App Router de Next 16 usa React 19.2, que incluye el componente `ViewTransition` sobre la View Transitions API del navegador, sin configuración adicional. Las navegaciones del router ya son *transitions*, así que las animaciones se activan solas.

Para animar cada cambio de página envolvemos el contenido con una `key` por ruta:

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

Las animaciones viven en CSS (`::view-transition-old(.page-exit)` y `::view-transition-new(.page-enter)`) y se desactivan con `prefers-reduced-motion`. Las portadas de los casos tienen además un `name` compartido con `share="morph"`, así que la imagen del listado "vuela" hasta la cabecera del detalle. Un aprendizaje de la documentación: con `default="none"` en un par con nombre, hay que mantener el `share` explícito, o el morph deja de funcionar sin avisar.

## La lección: un `loading.tsx` que convertía el 404 en 200

Esta no aparece en la guía de migración. La página de detalle de un caso llama a `notFound()` cuando la API responde 404. Se veía la página de "no encontrado", pero el código HTTP era **200**.

La causa es el streaming. Un `loading.tsx` crea un límite de Suspense; cuando su fallback se renderiza, la respuesta empieza a enviarse y las cabeceras, con su código de estado, ya salieron. Cuando después la página llama a `notFound()`, Next ya no puede cambiar el 200. Next sí añade `noindex` al HTML, así que no se indexa, pero para un monitoreo o un crawler estricto sigue siendo un *soft 404*.

La referencia de `loading.tsx` lo explica: si necesitas un 404 real, comprueba que el recurso exista antes de que empiece el streaming. Lo resolvimos con la estructura de carpetas, usando un grupo de rutas:

- `app/[lang]/(with-loading)/loading.tsx`: el estado de carga;
- `app/[lang]/(with-loading)/page.tsx`, `casos/page.tsx` y `servicios/page.tsx`: los listados, que sí se benefician del `loading`;
- `app/[lang]/casos/[slug]/page.tsx`: el detalle, **fuera** del grupo.

Los grupos entre paréntesis no aparecen en la URL, así que `/es/casos` y `/es/casos/mi-caso` siguen viéndose igual, pero solo los listados quedan bajo el `loading.tsx`. El detalle responde un 404 de verdad. Ahora es una regla del proyecto: toda página que pueda llamar a `notFound()` va fuera de `(with-loading)`.

## Turbopack por defecto

Turbopack es estable y es el empaquetador por defecto tanto en `next dev` como en `next build`; ya no hace falta `--turbopack`. Si un proyecto tiene una configuración `webpack` propia (o la añade un plugin), `next build` falla para evitar configuraciones que no se aplicarían. En ese caso se puede migrar a las opciones de `turbopack` o seguir con `--webpack`. Nuestros `package.json` quedaron con un simple `"build": "next build"`.

## En resumen

- `middleware.ts` pasa a `proxy.ts`, con la función `proxy` y siempre en el runtime de Node.js.
- `params`, `searchParams`, `cookies()` y `headers()` solo funcionan con `await`; `PageProps` los tipa.
- `revalidateTag` exige un perfil: `"max"` para *stale-while-revalidate* y `{ expire: 0 }` cuando un webhook necesita expirar al instante.
- `ViewTransition` de React 19.2 da transiciones de página y morphs sin librerías.
- Un `loading.tsx` encima de una página con `notFound()` hace que responda 200: saca esas páginas del grupo.
- Turbopack ya es el empaquetador por defecto.

¿Estás migrando a Next.js 16 o empezando un proyecto con él? En MWP ya pasamos por estos cambios y podemos ayudarte. La guía oficial es la [actualización a la versión 16](https://nextjs.org/docs/app/guides/upgrading/version-16).
