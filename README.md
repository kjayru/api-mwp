# api-mwp

API de **miwebprofesional** (NestJS 12, ESM, Prisma 7, PostgreSQL + pgvector). La consumen `front-mwp` (sitio público) y `admin-mwp` (panel). Plan de desarrollo: `c:\proyectos-react\front-mwp\docs\PLAN.md`.

## Requisitos

- Node.js 24 (o 22.18+; el seed usa el *type stripping* nativo de Node con `--experimental-strip-types`)
- Docker Desktop (base de datos local)

## Puesta en marcha

```bash
npm install          # también genera el cliente de Prisma (postinstall)
cp .env.example .env # en Windows: copy .env.example .env
# Edita .env: JWT_SECRET y SEED_ADMIN_PASSWORD son obligatorios (ver abajo)
npm run db:up        # PostgreSQL 17 + pgvector en localhost:5433
npm run db:deploy    # aplica las migraciones
npm run db:seed      # admin, ajustes, tecnologías, servicios, los 5 casos, el blog y las FAQ (idempotente)
npm run start:dev    # http://localhost:3001/api/v1
```

Comprobación: `GET http://localhost:3001/api/v1/health` devuelve `{"status":"ok","database":"up","pgvector":true,...}`. Si la base de datos no responde, devuelve `503` con `"database":"down"`.

## Variables de entorno

Se validan al arrancar (`src/config/env.ts`); la API no inicia si falta alguna obligatoria. `.env.example` tiene la lista completa.

| Variable | Obligatoria | Por defecto | Uso |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `test` o `production` |
| `PORT` | no | `3001` | Puerto HTTP |
| `TRUST_PROXY` | no | `loopback` | `trust proxy` de Express: de qué proxies se acepta `X-Forwarded-For` (`req.ip` de los límites por IP). `false`, `true`, un número de saltos o una lista de IPs/subredes separadas por comas (`loopback`, `linklocal`, `uniquelocal` incluidos). `false` si la API se expone sin proxy |
| `DATABASE_URL` | sí | — | PostgreSQL (`postgresql://...`) |
| `CORS_ORIGINS` | no | `http://localhost:3000,http://localhost:3002` | Orígenes permitidos, separados por comas |
| `JWT_SECRET` | sí | — | Clave HS256 de los access tokens, mínimo 32 caracteres. Genera una con `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_ACCESS_TTL_SECONDS` | no | `900` | Vida del access token (15 min) |
| `REFRESH_TOKEN_TTL_DAYS` | no | `7` | Vida del refresh token |
| `SEED_ADMIN_EMAIL` | no (solo seed) | `admin@miwebprofesional.com` | Email del admin que crea el seed |
| `SEED_ADMIN_NAME` | no (solo seed) | `Wile` | Nombre del admin |
| `SEED_ADMIN_PASSWORD` | **sí para el seed** | — | Contraseña inicial del admin (mínimo 8 caracteres). Sin ella el seed falla |
| `OBSERVE_APP_KEY` / `OBSERVE_APP_SECRET` | no | — | Telemetría de NestJS Observe (solo si están ambas) |
| `UPLOADS_DIR` | no | `./uploads` | Carpeta donde se guardan las imágenes subidas (relativa al directorio de trabajo). Se sirve en `/uploads` |
| `PUBLIC_UPLOADS_URL` | no | `http://localhost:3001/uploads` | URL pública de `UPLOADS_DIR`; las subidas devuelven `<PUBLIC_UPLOADS_URL>/<aaaa>/<mm>/<archivo>` |
| `FRONT_REVALIDATE_URL` | no | — | Webhook de revalidación de front-mwp (dev: `http://localhost:3000/api/revalidate`). Vacía = desactivado |
| `REVALIDATE_SECRET` | sí, si hay `FRONT_REVALIDATE_URL` | — | Secreto compartido con front-mwp (cabecera `x-revalidate-secret`), mínimo 32 caracteres. **El mismo valor** en el `.env.local` de front-mwp |
| `ANTHROPIC_API_KEY` | no (sí para el asistente) | — | Clave de la API de Claude. Sin ella la API arranca, pero el chat y "Probar pregunta" responden 503 |
| `VOYAGE_API_KEY` | no (sí para el asistente) | — | Clave de Voyage AI (embeddings de la base de conocimiento). Sin ella no se indexa ni se busca. **Añade un método de pago en el panel de Voyage**: sin él la cuenta queda limitada a 3 peticiones/min y 10K tokens/min (cada pregunta que busca consume una) |
| `VOYAGE_MODEL` | no | `voyage-3.5` | Modelo multilingüe de Voyage. Debe devolver vectores de **1024** dimensiones (columna `vector(1024)`): `voyage-3.5`, `voyage-3.5-lite` o la familia `voyage-4`. Cambiarlo exige "Reindexar ahora" |
| `KNOWLEDGE_MIN_SIMILARITY` | no | `0.5` | Similitud coseno mínima (0–1) para que un fragmento cuente como relevante. Por debajo, `buscar_casos` no devuelve nada y la pregunta se marca "sin respuesta" |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | no (las tres o ninguna) | — | Google Calendar (OAuth 2.0 con acceso offline de la cuenta del estudio; scopes `calendar.events` y `calendar.freebusy`). Sin ellas `agendar_reunion` guarda una reunión `REQUESTED` y el equipo la confirma por email |
| `RECAPTCHA_SECRET_KEY` | no | — | Clave secreta de reCAPTCHA v3. Si está, `POST /leads` exige `recaptchaToken` (acción `contact`) y responde 400 `recaptcha_failed` si falla; si Google no responde, acepta el lead (fail open). Sin ella no se verifica (docs/API.md 11.1). `RECAPTCHA_PUBLIC_KEY` es del front y la API la ignora |
| `RECAPTCHA_MIN_SCORE` | no | `0.5` | Puntuación mínima (0–1) de reCAPTCHA para aceptar el formulario |
| `BREVO_API_KEY` | no | — | Clave REST de Brevo (`xkeysib-…`, permiso de envío). Si está, es el proveedor de email de los avisos de lead y exige `MAIL_FROM` (docs/API.md 11.2) |
| `MAIL_FROM` | con `BREVO_API_KEY` | — | Remitente `Nombre <email>` o email; debe ser un sender verificado o de un dominio autenticado en Brevo |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | no (las cinco o ninguna) | — | Cuenta SMTP que avisa por email a `SiteSettings.contactEmail` de cada lead nuevo (docs/API.md 11.2). Alternativa a Brevo. Sin proveedor solo se registra en el log |
| `SMTP_SECURE` | no | `true` en el puerto 465 | TLS implícito (`true`/`false`); si no, STARTTLS |
| `ADMIN_URL` | no | `http://localhost:3002` | URL de admin-mwp para el enlace del email (`<ADMIN_URL>/leads/<id>`) |

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

- **Convenciones:** tablas y columnas en `snake_case` (`@@map`/`@map`) para que el SQL a mano de pgvector (Fase 4) sea legible; ids `cuid`; `created_at`/`updated_at` en todas las tablas; borrado lógico (`deleted_at`) en casos, tecnologías, servicios, blog y leads. Las tablas puente (`case_technologies`, `service_technologies` y, desde la Fase 3.6, `blog_post_technologies`, migración `20261004213817_blog_technologies`) usan clave primaria compuesta y guardan el orden de los chips.
- **Bilingüe ES/EN:** una fila `*Translation` por idioma (`@@unique([padre, locale])`), slug único por idioma y estado `DRAFT`/`PUBLISHED` + `publishedAt` por traducción. El sitio no muestra un idioma sin traducción publicada.
- **Usuarios y sesiones:** `User` (`ADMIN` | `EDITOR`, email en minúsculas, `isActive`, `lastLoginAt`) y `RefreshToken` (solo el sha256 del token, `expiresAt`, `revokedAt`, `replacedById` para la rotación, `userAgent`, `ip`).
- **Casos:** `Case` (tipo `SAAS | ECOMMERCE | WEB_CMS | TOOL | PLATFORM`, cliente, `anonymizeClient`, año, portada, `includeInKnowledgeBase`, orden) + `CaseTranslation` (título, slug, `tagline` para listados y la tarjeta "Caso citado", resumen, industria, `blocks`, SEO con `seoDescription` ≤ 160). `blocks` es un array JSON ordenado; tipos en `src/modules/cases/entities/case-block.entity.ts`:
  - `{ "type": "text", "title": "El reto", "body": "..." }`
  - `{ "type": "gallery", "imageIds": ["<CaseImage.id>"], "caption": "..." }` (puede venir vacío mientras se edita; el front no debe pintarlo)
  - `{ "type": "metrics", "items": [{ "value": "35%", "label": "..." }] }`
- **Galería:** `CaseImage` (url, orden) compartida por ambos idiomas; solo el `alt` se traduce, como JSON `{ "ES": "...", "EN": "..." }` (textos cortos que nunca se filtran: no justifican otra tabla).
- **Tecnologías:** nombre (no se traduce), slug, `category` como enum (`FRONTEND`, `BACKEND`, `DATABASE`, `MOBILE`, `CLOUD`, `AI`, `OTHER`; los frontends traducen la etiqueta), `isFeatured` (marquee de la Home), orden y `TechnologyTranslation` con una descripción opcional por idioma.
- **Servicios** y **blog:** con traducciones (los servicios con slug por idioma como ancla en `/servicios`; el blog en Markdown).
- **Leads:** origen `CHAT_IA | FORM`, estado `NEW | CONTACTED | PROPOSAL | WON | LOST`, `locale` y `conversationId` (FK a `Conversation` desde la Fase 4; solo en los leads del chat).
- **PageView:** agregado por día (`date`, `path`, `locale`, `count`, único por los tres). Registrar una visita es un upsert atómico `count + 1`; el KPI "Visitas" suma pocas filas, la tabla no crece por visita y no guarda datos personales. No permite contar visitantes únicos.
- **SiteSettings:** fila única con id `default`: email, WhatsApp, `socialLinks`, `businessHours` (`{ "mon": [{ "start": "08:00", "end": "19:00" }], ..., "sun": [] }`), `timezone` `America/Lima` y `meetingDurationMinutes` 30.
- La extensión `vector` la crea la migración inicial y no se declara en el esquema.

### Seed

`prisma/seed.ts` (contenido en `prisma/seed-data.ts`) se ejecuta con el *type stripping* nativo de Node y un pequeño hook (`prisma/ts-resolve-hook.mjs`) que resuelve los imports `./x.js` a `./x.ts`; así no hace falta `tsx` ni esbuild, que tienen scripts de instalación. Es idempotente:

- **Admin:** se crea con `SEED_ADMIN_*`. En ejecuciones posteriores solo se fuerzan `role = ADMIN` e `isActive = true`; la contraseña nunca se sobrescribe.
- **SiteSettings:** se crea una vez; después se respetan los cambios hechos desde el admin.
- **Tecnologías, servicios, casos y artículos del blog:** solo se crean si no existen (claves naturales: slug o nombre de la tecnología y slug ES de la traducción). Lo que ya existe —editado o borrado desde el admin— no se toca, así que el seed se puede repetir en QA sin perder contenido. Las tecnologías nuevas se añaden al final del orden actual.
- **Blog:** ver "Seed del blog" más abajo.
- Marcadores pendientes: `[completar]` (datos que aún no tenemos; nunca inventar resultados de clientes), `[N]` (métricas) y `[revisar]` (textos escritos para el seed, no del mockup).

### Seed del blog

Los artículos iniciales se leen de **`prisma/seed-content/blog/`** (código en `prisma/blog-content.ts`). Se crean **publicados en ES y EN**, con el admin (`SEED_ADMIN_EMAIL`) como autor, sus tecnologías en orden y la fecha del archivo como `publishedAt`. Como el resto del seed, es de solo creación: si el slug ES ya existe, el artículo no se toca. **Para cambiar un artículo ya sembrado, edítalo desde el admin** (o bórralo de la base y vuelve a ejecutar el seed).

- **Archivos:** un par por artículo, `<clave>.es.md` y `<clave>.en.md`, donde `<clave>` es el slug ES. Los archivos que no siguen ese patrón se ignoran (el seed los lista).
- **Formato:** un bloque de *frontmatter* entre dos líneas `---` y después el cuerpo en Markdown. **Cada línea del frontmatter es `clave: <valor JSON>`**: se lee con `JSON.parse`, no es YAML, así que los textos van entre comillas dobles. Se admiten líneas en blanco, BOM y finales de línea CRLF.

  ```
  ---
  title: "Lo que cambió en Next.js 16"
  slug: "lo-que-cambio-en-nextjs-16"
  excerpt: "..."
  seoTitle: "..."
  seoDescription: "..."
  technologies: ["nextjs", "react"]
  publishedAt: "2026-09-12"
  ---
  Cuerpo en Markdown...
  ```

- **Reglas.** Si algo falla, el seed se detiene **antes de escribir nada** y lista cada problema con el nombre de su archivo.
  - Claves permitidas: `title`, `slug`, `excerpt`, `seoTitle` (opcional), `seoDescription`, `technologies` y `publishedAt`. Una clave desconocida o repetida es un error.
  - Obligatorias en los dos idiomas: `title` (≤ 200), `slug` (formato `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 120), `excerpt` (≤ 500), `seoDescription` (≤ 160) y un cuerpo no vacío (≤ 100 000 caracteres). `seoTitle` admite hasta 200.
  - `technologies` y `publishedAt` son obligatorias en el archivo ES. En el EN pueden omitirse; si aparecen, deben coincidir con las del ES, que son las que se usan.
  - `technologies`: slugs de tecnologías que existan en `seed-data.ts` o en la base, sin repetir (máximo 20).
  - `publishedAt`: `AAAA-MM-DD` (medianoche UTC) o una fecha-hora ISO 8601 válida.
  - El nombre del archivo ES debe coincidir con su `slug`, tienen que existir los dos idiomas y un slug no puede repetirse entre artículos del mismo idioma.
- Si la carpeta no existe o no tiene artículos, el seed lo indica y sigue. Al terminar escribe `blog posts: X created, Y kept`.
- Los tests usan sus propios archivos, con el mismo formato, en `test/fixtures/blog/`.

## API de contenido (Fase 3)

Contrato completo para front-mwp y admin-mwp en **[docs/API.md](docs/API.md)**: endpoints públicos (`/cases`, `/cases/:slug`, `/technologies`, `/services`, `/stats`, `/blog`, `/blog/:slug`), administración de casos, tecnologías, servicios y blog, subida de imágenes y el webhook de revalidación del front.

- **Blog (Fase 3.6, sección 9 de API.md):** artículos en Markdown por idioma, con portada, autor (quien lo crea) y tecnologías. Para publicar hacen falta título, slug, extracto y contenido. El sitio recibe el Markdown sin procesar, `readingMinutes` (lo calcula la API sin contar los bloques de código) y `previous`/`next` sin vuelta circular. Etiquetas de revalidación: `blog` y `post:<slug>`. Los cuerpos JSON admiten hasta 1 MB.

- **Públicos:** solo contenido publicado en el idioma pedido (`?locale=es|en`, obligatorio), con `Cache-Control: public, max-age=60`.
- **Admin** (`/admin/...`): roles `ADMIN` y `EDITOR`. Publicación por idioma con validación (422 con los campos que faltan). Borrado lógico y orden con `PUT /admin/<recurso>/order`.
- **Revalidación:** tras cada cambio de contenido público la API envía `POST FRONT_REVALIDATE_URL` con `{ tags }`. Es *fire-and-forget*: tiempo máximo de 3 s, sin reintentos y nunca hace fallar la petición del admin.

### Imágenes subidas

- `POST /api/v1/admin/uploads` (multipart, campo `file`) acepta JPEG, PNG, WebP y AVIF de hasta 5 MB. El tipo se comprueba por los *magic bytes* del archivo, no por el nombre ni por el mimetype. Usa el multer que trae `@nestjs/platform-express`; no añade dependencias.
- Los archivos se guardan en `UPLOADS_DIR` (por defecto `./uploads`, ignorado por git) como `<aaaa>/<mm>/<nombre aleatorio>.<ext>`.
- Se sirven en `/uploads/...`, fuera del prefijo `/api`, con caché de un año (`immutable`) y `X-Content-Type-Options: nosniff`. No se listan directorios ni se sirve nada fuera de `UPLOADS_DIR`.
- El almacenamiento está detrás de `FileStorage` (`src/modules/uploads/storage/`). Hoy solo existe `LocalFileStorage`; para S3 se añade otra implementación.
- **Despliegue (QA):** el redespliegue de `docs/DEPLOY-QA.md` borra todo `/srv/mwp/api` salvo `node_modules`, así que `UPLOADS_DIR` debe apuntar **fuera** del código (p. ej. `/srv/mwp/uploads`, propiedad de `mwp`, y permitido en `ReadWritePaths` si el servicio usa `ProtectSystem`). Hay que fijar también `PUBLIC_UPLOADS_URL=https://api.miwebprofesional.com/uploads` y comprobar que el vhost reenvía `/uploads` a la API.

## Asistente IA (Fase 4)

Contrato completo (SSE incluido) en la **sección 10 de [docs/API.md](docs/API.md)**. Resumen:

- **Chat** `POST /api/v1/assistant/chat` (público, SSE) con **Claude Sonnet 5.5** (`AssistantSettings.model`), esfuerzo `low` por defecto, sin `temperature`, *prompt caching* (tools → system → mensajes) y *fallback* de rechazos en el servidor (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Usa el SDK oficial `@anthropic-ai/sdk` (`client.beta.messages.stream`) detrás de `MODEL_CLIENT` (`src/modules/assistant/model-client.ts`).
- **Tools** (`strict: true`, `eager_input_streaming` y validación con zod antes de ejecutar): `buscar_casos`, `crear_lead` (un lead por conversación, origen `CHAT_IA`) y `agendar_reunion` (horario de `SiteSettings`; Google Calendar con `fetch`, sin `googleapis`, detrás de `CalendarProvider`).
- **Base de conocimiento** (`src/modules/knowledge`): fragmentos por idioma de los casos publicados con `includeInKnowledgeBase` (sin el cliente si está anonimizado) y de las FAQ publicadas, con embeddings de Voyage (`EmbeddingsProvider`; `input_type` `document` al indexar y `query` al buscar) en `knowledge_chunks` (pgvector, índice HNSW coseno). Se sincroniza sola al editar, publicar, despublicar o borrar un caso o una FAQ (en segundo plano, sin hacer fallar la petición del admin); un fragmento sin cambios conserva su embedding.
- **Después del seed** hay que indexar una vez: `POST /api/v1/admin/knowledge/reindex` ("Reindexar ahora" en el admin). El seed no llama a Voyage.
- **Umbral de similitud** (`KNOWLEDGE_MIN_SIMILARITY = 0.5`): medido con preguntas reales sobre el contenido del seed. Con las consultas que escribe el modelo, las relevantes dieron 0,53–0,73 y las ajenas (relojes inteligentes, lavadoras, coches usados, el clima, videojuegos, criptomonedas) 0,33–0,50. Revísalo cuando crezca la base de conocimiento: la similitud de cada búsqueda queda en `toolCalls` de cada mensaje.
- **Módulos:** `assistant` (chat, motor, tools y endpoints de admin), `assistant-settings`, `conversations`, `knowledge`, `faqs`, `calendar`, `leads` (por ahora solo los leads del chat) y `stats` (`/admin/stats/overview`).
- **Modelo de datos** (migración `20261125022717_phase4_assistant`): `FaqDocument` + `FaqDocumentTranslation`, `KnowledgeChunk` (`embedding vector(1024)`), `IndexingRun`, `Conversation`, `Message`, `Meeting`, `AssistantSettings` (fila única `default`, la crea el seed) y la FK `Lead.conversationId` → `Conversation`. El seed crea también 3 FAQ genéricas (soporte, plazos y pagos, sin precios) para revisar en el admin.
- **Índice HNSW y `prisma migrate dev`:** Prisma no sabe declarar índices HNSW, así que `knowledge_chunks_embedding_hnsw_idx` se crea en el SQL de la migración. Por eso `migrate dev` lo ve como *drift* y propone borrarlo: **en cada migración nueva generada con `--create-only`, elimina la línea `DROP INDEX "knowledge_chunks_embedding_hnsw_idx"`** antes de aplicarla. Un test e2e comprueba que el índice existe.
- **Límites:** 10 mensajes/min por IP y por `visitorId` (`@nestjs/throttler`, en memoria) y `maxMessagesPerSession` mensajes por conversación. Detrás de Apache todas las IPs son `127.0.0.1` hasta configurar `trust proxy` (Fase 7), así que hoy el límite efectivo por visitante es el del `visitorId`.
- **Prueba real:** con la API levantada y las claves reales, reindexa y pregunta por SSE:

  ```bash
  curl -N -X POST http://localhost:3001/api/v1/assistant/chat \
    -H "Content-Type: application/json" \
    -d '{"visitorId":"prueba-123456","locale":"es","message":"¿Tienen experiencia con sistemas para contadores?"}'
  ```

## Auth API

Todas las rutas están bajo `/api/v1`. Un `JwtAuthGuard` global protege **todas** las rutas salvo las marcadas con `@Public()` (health, login, refresh y logout); `@Roles('ADMIN')` restringe por rol (403 si no se cumple). Los errores siguen el formato común `{ statusCode, error, message, path, timestamp }`.

| Método y ruta | Auth | Cuerpo | Respuesta |
|---|---|---|---|
| `POST /auth/login` | pública, **5 req/min por IP** | `{ "email": string, "password": string }` | **200** `AuthResponse` · **401** `"Credenciales inválidas"` (contraseña incorrecta, email desconocido o usuario inactivo) · **400** cuerpo inválido · **429** demasiados intentos (cabecera `Retry-After`) |
| `POST /auth/refresh` | pública | `{ "refreshToken": string }` | **200** `AuthResponse` (rota el refresh token) · **401** token desconocido, expirado o ya usado · **400** |
| `POST /auth/logout` | pública | `{ "refreshToken": string }` | **204** sin cuerpo, siempre (idempotente, también para tokens desconocidos) · **400** |
| `GET /auth/me` | `Authorization: Bearer <accessToken>` | — | **200** `{ id, email, name, role }` · **401** |
| `POST /auth/password` | `Authorization: Bearer <accessToken>` | `{ "currentPassword": string, "newPassword": string }` (12–128) | **204** y revoca las demás sesiones · **400** `invalid_password` / `same_password` (en `details.reason`) o cuerpo inválido · **401** (docs/API.md 11.6) |

```jsonc
// AuthResponse
{
  "accessToken": "eyJ...",              // JWT HS256: sub, email, role, sid (sesión); 15 min
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
- El límite de login se guarda en memoria (por instancia) y usa `req.ip`, que detrás de Apache es la IP del visitante gracias a `TRUST_PROXY` (por defecto `loopback`).

## Tests

- **Unitarios** (`npm test`): `*.spec.ts` junto al código, con dependencias simuladas.
- **E2E** (`npm run test:e2e`): `test/*.e2e-spec.ts` con la configuración global de `main.ts`. El `globalSetup` (`test/global-setup.ts`) crea la base `mwp_test` en el mismo contenedor (si no existe) y aplica las migraciones con `prisma migrate deploy`; cada test vacía las tablas (`TRUNCATE`). Los archivos se ejecutan en serie. Necesita la base de datos levantada (`npm run db:up`). Las subidas de los e2e van a una carpeta temporal del sistema (`<tmp>/mwp-e2e-uploads`), nunca a `./uploads`. El webhook de revalidación está desactivado salvo en `test/revalidation.e2e-spec.ts`, que lo dirige a un servidor HTTP local.
- **Asistente:** los tests nunca llaman a Claude, Voyage ni Google. `test/assistant.e2e-spec.ts` sustituye `MODEL_CLIENT` y `EMBEDDINGS_PROVIDER` por `test/utils/fake-model-client.ts` (respuestas guionizadas) y `test/utils/fake-embeddings.ts` (bolsa de palabras determinista) con `overrideProvider` de Nest, y los unitarios simulan `fetch` para Voyage y Google Calendar.

## Convenciones

- Rutas bajo `/api/v1/...`; los errores siguen el formato `{ statusCode, error, message, path, timestamp }`, más un campo `details` opcional y legible por máquina (p. ej. en los 422 de publicación).
- Las rutas nuevas están protegidas por defecto; usa `@Public()` solo cuando deban ser abiertas y `@Roles(...)` para restringir por rol.
- Nunca se registran en logs contraseñas ni tokens.
- La telemetría de NestJS Observe solo se activa si se definen `OBSERVE_APP_KEY` y `OBSERVE_APP_SECRET`.
- Proyecto ESM: los imports relativos llevan extensión `.js`.
