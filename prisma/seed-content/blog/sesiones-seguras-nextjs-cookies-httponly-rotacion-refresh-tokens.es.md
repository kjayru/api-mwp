---
title: "Sesiones seguras en Next.js: cookies httpOnly y rotación de refresh tokens con detección de robo"
slug: "sesiones-seguras-nextjs-cookies-httponly-rotacion-refresh-tokens"
excerpt: "Cómo protegemos el panel de administración: access token de 15 minutos, refresh token opaco que rota en cada uso, cookies httpOnly, un proxy.ts que renueva sin duplicar y verificación real en el servidor."
seoTitle: "Sesiones seguras en Next.js con rotación de refresh tokens"
seoDescription: "JWT de 15 min, refresh token opaco guardado como sha256, rotación con detección de reutilización, cookies httpOnly, renovación deduplicada en proxy.ts y scrypt."
technologies: ["nextjs", "nestjs", "postgresql"]
publishedAt: "2026-09-14"
---

El panel de administración de miwebprofesional (Next.js 16) se autentica contra nuestra API (NestJS 12 con PostgreSQL). Queríamos sesiones que duren días sin que un token robado sirva durante días, y que el JavaScript del navegador nunca vea un token. Este es el diseño, con su código y los problemas que encontramos.

## Dos tokens con trabajos distintos

| | Access token | Refresh token |
|---|---|---|
| Formato | JWT firmado (HS256) | 32 bytes aleatorios en base64url (opaco) |
| Duración | 15 minutos | 7 días |
| Dónde se valida | En cada petición, por firma | Solo en `POST /auth/refresh`, contra la base de datos |
| Qué guardamos | Nada | Solo su hash sha256 |

Si el access token se filtra, sirve como mucho 15 minutos. El refresh token no es un JWT porque no necesita llevar información: es un valor aleatorio que solo vale si existe en nuestra tabla:

```ts
import { createHash, randomBytes } from 'node:crypto';

/** sha256 (hex) de un token opaco. Solo este hash se guarda en la base de datos. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}
```

Así, un volcado de la base de datos no contiene sesiones utilizables. Con 256 bits de entropía basta un sha256; no hace falta un hash lento como el de las contraseñas.

## Rotación y detección de reutilización

Cada vez que se usa un refresh token, se revoca y se emite uno nuevo, enlazado al anterior (`replacedById`). La regla clave es esta: **si alguien presenta un refresh token ya revocado, asumimos robo y revocamos todas las sesiones del usuario**. Alguien (el atacante o el usuario) tiene un token viejo y no sabemos quién, así que ambos vuelven a iniciar sesión.

```ts
if (stored.revokedAt) {
  await this.revokeAllSessions(stored.userId, 'refresh token reuse');
  throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
}
```

Hay una carrera sutil: dos peticiones con el mismo token pueden leerlo como válido al mismo tiempo. Por eso la revocación es una actualización condicional dentro de una transacción. Solo una puede "ganar", y la otra se trata como reutilización:

```ts
const session = await this.prisma.$transaction(async (tx) => {
  // Si una petición concurrente ya rotó este token, ninguna fila coincide.
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

Esta regla es estricta, y eso trae una consecuencia en el cliente que veremos más abajo.

## Cookies httpOnly: el token nunca llega al JavaScript

El panel no guarda tokens en `localStorage` ni los pasa a componentes de cliente. Viajan en cookies `httpOnly`, que el navegador envía pero el JavaScript de la página no puede leer, así que un XSS no puede robarlas:

```ts
store.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: tokens.accessTokenExpiresIn,
});
// El refresh token usa las mismas opciones, con `expires` en su fecha de caducidad.
```

`sameSite: "lax"` evita que la cookie viaje en POST desde otros sitios, y las Server Actions de Next ya rechazan peticiones de otro origen. El helper acepta tanto el `cookies()` de una Server Action como `NextResponse.cookies` del proxy.

## `proxy.ts`: renovar antes de que caduque

En Next 16 el antiguo middleware se llama `proxy.ts`. El nuestro mira las cookies en cada petición y, si al access token le queda menos de un minuto, lo renueva con el refresh token antes de que la página se renderice:

```ts
if (hasFreshAccessToken) return NextResponse.next();

if (!refreshToken) {
  return redirectToLogin(request, { clearCookies: accessToken !== undefined });
}

const result = await refreshSession(refreshToken);
if (result.ok) return continueWithTokens(request, result.tokens);
```

El proxy lee el `exp` del JWT **sin verificar la firma**: el panel no tiene el secreto de la API, ni debe tenerlo. Ese dato solo decide cuándo renovar, nunca a quién dejar pasar.

`continueWithTokens` escribe las cookies nuevas en la respuesta (para el navegador) y en la petición que sigue, para que los Server Components de esa misma petición lean el token nuevo con `cookies()`.

Si la API no responde (caída, timeout o error 5xx), el proxy **no** borra las cookies: una caída no debe parecer un cierre de sesión.

## Por qué hay que deduplicar las renovaciones

Aquí la regla estricta de la API se cobra su precio. Cuando un usuario vuelve a una pestaña con el access token vencido, el navegador lanza varias peticiones casi a la vez (el documento, prefetches de RSC, quizá una Server Action), todas con **el mismo** refresh token. Si cada una renovara por su cuenta, la primera rotaría el token, la segunda presentaría uno revocado y la API, haciendo su trabajo, cerraría todas las sesiones.

La solución: las renovaciones concurrentes del mismo token comparten una sola llamada, y un éxito se reutiliza durante un periodo de gracia corto:

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
      // Solo se reutilizan los éxitos; un fallo puede reintentarse.
      recentRefreshes.delete(refreshToken);
    }
    return result;
  });
  recentRefreshes.set(refreshToken, { promise, expiresAt: Number.POSITIVE_INFINITY });
  return promise;
}
```

El periodo de gracia cubre las peticiones que ya iban en camino con la cookie vieja. Una limitación honesta: el mapa vive en memoria, **por proceso**. Con varias instancias del panel, dos podrían renovar el mismo token a la vez; para ese escenario, la API tendría que tolerar una ventana corta de reutilización, y está anotado para cuando escalemos.

## El proxy no autentica: la verificación real va en el servidor

Que el proxy deje pasar una petición no significa que el usuario esté autenticado: solo hizo una comprobación optimista de cookies. La verificación real vive en una capa de acceso a datos (DAL) que confirma cada sesión con la API (`GET /auth/me`) y toma de ahí el usuario y su rol:

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

`cache` de React memoriza el resultado durante la petición. Toda Server Action que lea o modifique datos llama a `requireUser()`, porque es un endpoint POST público y el chequeo del layout no corre para ella. Y como los layouts no se vuelven a renderizar al navegar en el cliente, las funciones que cargan datos también lo llaman.

## Contraseñas con scrypt, sin dependencias nativas

En la API, las contraseñas se derivan con `scrypt` de `node:crypto`, sin paquetes que compilen código nativo al instalarse. El resultado se guarda con sus parámetros:

```ts
/** Devuelve `scrypt$N$r$p$salt$hash` (salt y hash en base64url). */
export async function hashPassword(password: string, params = DEFAULT_SCRYPT_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, KEY_BYTES, params);
  return [PREFIX, params.N, params.r, params.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}
```

Guardar `N`, `r` y `p` permite subir el costo más adelante: en un login exitoso, un hash con parámetros más débiles que los actuales se recalcula de forma transparente. La comparación usa `timingSafeEqual`, y los emails inexistentes se comparan contra un hash ficticio para que tarden lo mismo y no revelen qué cuentas existen.

## Login limitado, con una advertencia

`POST /auth/login` permite 5 intentos por minuto por IP, con `@nestjs/throttler` en memoria. Frena la fuerza bruta básica, con una trampa conocida: detrás de un proxy inverso, Node ve la IP del proxy, no la del cliente. Sin configurar `trust proxy`, todos compartirían el mismo contador y unos pocos fallos bloquearían a todos. Lo tenemos pendiente para el endurecimiento de producción, junto con un almacenamiento compartido si la API corre en varias instancias.

## En resumen

- Access JWT de 15 minutos y refresh token opaco de 7 días, guardado solo como sha256.
- Cada refresh rota el token; reutilizar uno revocado cierra todas las sesiones del usuario.
- Los tokens viajan en cookies `httpOnly`, `sameSite: "lax"`, y nunca llegan al JavaScript del navegador.
- `proxy.ts` renueva antes de que el token caduque y **comparte una sola renovación** entre peticiones simultáneas; sin eso, la rotación cerraría la sesión.
- El proxy no autentica: `requireUser()` confirma la sesión con la API en cada Server Action y carga de datos.
- `scrypt` con parámetros guardados en el hash y límite de intentos por IP, teniendo en cuenta el proxy inverso.

Si tu aplicación necesita sesiones así, o quieres que revisemos la que ya tienes, conversemos. Para profundizar, la guía de [autenticación de Next.js](https://nextjs.org/docs/app/guides/authentication) y la [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) son lecturas recomendadas.
