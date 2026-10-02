# api-mwp

API de **miwebprofesional** (NestJS 12, ESM, Prisma 7, PostgreSQL + pgvector). La consumen `front-mwp` (sitio público) y `admin-mwp` (panel). Plan de desarrollo: `c:\proyectos-react\front-mwp\docs\PLAN.md`.

## Requisitos

- Node.js 24 (≥ 22.18: el seed usa el *type stripping* nativo de Node)
- Docker Desktop (base de datos local)

## Puesta en marcha

```bash
npm install          # también genera el cliente de Prisma (postinstall)
cp .env.example .env # en Windows: copy .env.example .env
# Edita .env: JWT_SECRET y SEED_ADMIN_PASSWORD son obligatorios (ver abajo)
npm run db:up        # PostgreSQL 17 + pgvector en localhost:5433
npm run db:deploy    # aplica las migraciones
npm run db:seed      # admin, ajustes, tecnologías, servicios y los 5 casos (idempotente)
npm run start:dev    # http://localhost:3001/api/v1
```

Comprobación: `GET http://localhost:3001/api/v1/health` devuelve `{"status":"ok","database":"up","pgvector":true,...}`. Si la base de datos no responde, devuelve `503` con `"database":"down"`.

## Variables de entorno

Se validan al arrancar (`src/config/env.ts`); la API no inicia si falta alguna obligatoria. `.env.example` tiene la lista completa.

| Variable | Obligatoria | Por defecto | Uso |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `test` o `production` |
| `PORT` | no | `3001` | Puerto HTTP |
| `DATABASE_URL` | sí | — | PostgreSQL (`postgresql://...`) |
| `CORS_ORIGINS` | no | `http://localhost:3000,http://localhost:3002` | Orígenes permitidos, separados por comas |
| `JWT_SECRET` | sí | — | Clave HS256 de los access tokens, mínimo 32 caracteres. Genera una con `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_ACCESS_TTL_SECONDS` | no | `900` | Vida del access token (15 min) |
| `REFRESH_TOKEN_TTL_DAYS` | no | `7` | Vida del refresh token |
| `SEED_ADMIN_EMAIL` | no (solo seed) | `admin@miwebprofesional.com` | Email del admin que crea el seed |
| `SEED_ADMIN_NAME` | no (solo seed) | `Wile` | Nombre del admin |
| `SEED_ADMIN_PASSWORD` | **sí para el seed** | — | Contraseña inicial del admin (mínimo 8 caracteres). Sin ella el seed falla |
| `OBSERVE_APP_KEY` / `OBSERVE_APP_SECRET` | no | — | Telemetría de NestJS Observe (solo si están ambas) |

## Puertos del workspace

| Proyecto | Puerto |
|---|---|
| front-mwp | 3000 |
| api-mwp | 3001 |
| admin-mwp | 3002 |
| PostgreSQL (Docker) | 5433 (5432 suele estar ocupado por un PostgreSQL local) |

## Scripts

| Script | Qué hace |
|---|---|
| `start:dev` | API con recarga en caliente |
| `build` / `start:prod` | Compila a `dist/` y lo ejecuta |
| `test` / `test:cov` | Tests unitarios y cobertura |
| `test:e2e` | Tests e2e contra la base `mwp_test` (se crea y migra sola; ver abajo) |
| `lint` / `format` / `typecheck` | oxlint, Prettier y `tsc --noEmit` de todo el proyecto (incluye `prisma/` y `test/`) |
| `db:up` / `db:down` | Levanta o detiene la base de datos en Docker |
| `db:migrate` | Crea y aplica una migración en desarrollo (`prisma migrate dev`) |
| `db:deploy` | Aplica las migraciones pendientes (`prisma migrate deploy`) |
| `db:seed` | Carga los datos de desarrollo (`prisma db seed`); se puede repetir sin duplicar nada |
| `db:studio` | Prisma Studio |
| `user:set-password` | Cambia la contraseña de un usuario y cierra sus sesiones: `NEW_PASSWORD=... npm run user:set-password -- <email>` |
| `prisma:generate` | Regenera el cliente en `src/generated/prisma` (no se versiona) |

## Modelo de datos (Fase 2)

Esquema en `prisma/schema.prisma`; migración `20261002202732_phase2_domain_model`.

- **Convenciones:** tablas y columnas en `snake_case` (`@@map`/`@map`) para que el SQL a mano de pgvector (Fase 4) sea legible; ids `cuid`; `created_at`/`updated_at` en todas las tablas; borrado lógico (`deleted_at`) en casos, tecnologías, servicios, blog y leads. Las tablas puente (`case_technologies`, `service_technologies`) usan clave primaria compuesta y guardan el orden de los chips.
- **Bilingüe ES/EN:** una fila `*Translation` por idioma (`@@unique([padre, locale])`), slug único por idioma y estado `DRAFT`/`PUBLISHED` + `publishedAt` por traducción. El sitio no muestra un idioma sin traducción publicada.
- **Usuarios y sesiones:** `User` (`ADMIN` | `EDITOR`, email en minúsculas, `isActive`, `lastLoginAt`) y `RefreshToken` (solo el sha256 del token, `expiresAt`, `revokedAt`, `replacedById` para la rotación, `userAgent`, `ip`).
- **Casos:** `Case` (tipo `SAAS | ECOMMERCE | WEB_CMS | TOOL | PLATFORM`, cliente, `anonymizeClient`, año, portada, `includeInKnowledgeBase`, orden) + `CaseTranslation` (título, slug, `tagline` para listados y la tarjeta "Caso citado", resumen, industria, `blocks`, SEO con `seoDescription` ≤ 160). `blocks` es un array JSON ordenado; tipos en `src/modules/cases/entities/case-block.entity.ts`:
  - `{ "type": "text", "title": "El reto", "body": "..." }`
  - `{ "type": "gallery", "imageIds": ["<CaseImage.id>"], "caption": "..." }` (puede venir vacío mientras se edita; el front no debe pintarlo)
  - `{ "type": "metrics", "items": [{ "value": "35%", "label": "..." }] }`
- **Galería:** `CaseImage` (url, orden) compartida por ambos idiomas; solo el `alt` se traduce, como JSON `{ "ES": "...", "EN": "..." }` (textos cortos que nunca se filtran: no justifican otra tabla).
- **Tecnologías:** nombre (no se traduce), slug, `category` como enum (`FRONTEND`, `BACKEND`, `DATABASE`, `MOBILE`, `CLOUD`, `AI`, `OTHER`; los frontends traducen la etiqueta), `isFeatured` (marquee de la Home), orden y `TechnologyTranslation` con una descripción opcional por idioma.
- **Servicios** y **blog:** con traducciones (los servicios con slug por idioma como ancla en `/servicios`; el blog en Markdown).
- **Leads:** origen `CHAT_IA | FORM`, estado `NEW | CONTACTED | PROPOSAL | WON | LOST`, `locale` y `conversationId` sin FK (la relación llega en la Fase 4).
- **PageView:** agregado por día (`date`, `path`, `locale`, `count`, único por los tres). Registrar una visita es un upsert atómico `count + 1`; el KPI "Visitas" suma pocas filas, la tabla no crece por visita y no guarda datos personales. No permite contar visitantes únicos.
- **SiteSettings:** fila única con id `default`: email, WhatsApp, `socialLinks`, `businessHours` (`{ "mon": [{ "start": "08:00", "end": "19:00" }], ..., "sun": [] }`), `timezone` `America/Lima` y `meetingDurationMinutes` 30.
- La extensión `vector` la crea la migración inicial y no se declara en el esquema.

### Seed

`prisma/seed.ts` (contenido en `prisma/seed-data.ts`) se ejecuta con el *type stripping* nativo de Node y un pequeño hook (`prisma/ts-resolve-hook.mjs`) que resuelve los imports `./x.js` a `./x.ts`; así no hace falta `tsx` ni esbuild, que tienen scripts de instalación. Es idempotente:

- **Admin:** se crea con `SEED_ADMIN_*`. En ejecuciones posteriores solo se fuerzan `role = ADMIN` e `isActive = true`; la contraseña nunca se sobrescribe.
- **SiteSettings:** se crea una vez; después se respetan los cambios hechos desde el admin.
- **Tecnologías, servicios y casos:** se actualizan al contenido del seed (claves naturales: slug de la tecnología y slug ES de la traducción).
- Marcadores pendientes: `[completar]` (datos que aún no tenemos; nunca inventar resultados de clientes), `[N]` (métricas) y `[revisar]` (textos escritos para el seed, no del mockup).

## Auth API

Todas las rutas están bajo `/api/v1`. Un `JwtAuthGuard` global protege **todas** las rutas salvo las marcadas con `@Public()` (health, login, refresh y logout); `@Roles('ADMIN')` restringe por rol (403 si no se cumple). Los errores siguen el formato común `{ statusCode, error, message, path, timestamp }`.

| Método y ruta | Auth | Cuerpo | Respuesta |
|---|---|---|---|
| `POST /auth/login` | pública, **5 req/min por IP** | `{ "email": string, "password": string }` | **200** `AuthResponse` · **401** `"Credenciales inválidas"` (contraseña incorrecta, email desconocido o usuario inactivo) · **400** cuerpo inválido · **429** demasiados intentos (cabecera `Retry-After`) |
| `POST /auth/refresh` | pública | `{ "refreshToken": string }` | **200** `AuthResponse` (rota el refresh token) · **401** token desconocido, expirado o ya usado · **400** |
| `POST /auth/logout` | pública | `{ "refreshToken": string }` | **204** sin cuerpo, siempre (idempotente, también para tokens desconocidos) · **400** |
| `GET /auth/me` | `Authorization: Bearer <accessToken>` | — | **200** `{ id, email, name, role }` · **401** |

```jsonc
// AuthResponse
{
  "accessToken": "eyJ...",              // JWT HS256: sub, email, role; 15 min
  "accessTokenExpiresIn": 900,           // segundos
  "refreshToken": "7hJexFDu...",         // opaco, 43 caracteres base64url; 7 días
  "refreshTokenExpiresAt": "2026-10-09T20:38:31.886Z",
  "user": { "id": "cm...", "email": "admin@miwebprofesional.com", "name": "Wile", "role": "ADMIN" } // o "EDITOR"
}
```

Comportamiento a tener en cuenta en los clientes:

- **Rotación:** cada `refresh` revoca el token presentado y devuelve uno nuevo; guarda siempre el último.
- **Reutilización = robo:** presentar un refresh token ya revocado (por rotación o logout) revoca **todas** las sesiones activas del usuario y responde 401. Dos refresh simultáneos con el mismo token cuentan como reutilización: serializa los refresh en el cliente (una sola petición en vuelo).
- El email no distingue mayúsculas. Las contraseñas se guardan con scrypt (`scrypt$N$r$p$salt$hash`, `node:crypto`); el refresh token solo como sha256.
- El límite de login se guarda en memoria (por instancia) y usa `req.ip`; detrás de un proxy habrá que configurar `trust proxy` (Fase 7).

## Tests

- **Unitarios** (`npm test`): `*.spec.ts` junto al código, con dependencias simuladas.
- **E2E** (`npm run test:e2e`): `test/*.e2e-spec.ts` con la configuración global de `main.ts`. El `globalSetup` (`test/global-setup.ts`) crea la base `mwp_test` en el mismo contenedor (si no existe) y aplica las migraciones con `prisma migrate deploy`; cada test vacía las tablas (`TRUNCATE`). Los archivos se ejecutan en serie. Necesita la base de datos levantada (`npm run db:up`).

## Convenciones

- Rutas bajo `/api/v1/...`; los errores siguen el formato `{ statusCode, error, message, path, timestamp }`.
- Las rutas nuevas están protegidas por defecto; usa `@Public()` solo cuando deban ser abiertas y `@Roles(...)` para restringir por rol.
- Nunca se registran en logs contraseñas ni tokens.
- La telemetría de NestJS Observe solo se activa si se definen `OBSERVE_APP_KEY` y `OBSERVE_APP_SECRET`.
- Proyecto ESM: los imports relativos llevan extensión `.js`.
