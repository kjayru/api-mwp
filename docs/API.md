# api-mwp: API contract (Phases 3, 3.6 and 4)

This is the contract for **front-mwp** (public site) and **admin-mwp** (admin panel): cases, technologies, services, stats, the blog (Phase 3.6), image uploads, the front revalidation webhook and the AI assistant (Phase 4). Auth (`/auth/*`) is documented in the README.

- Base URL: `http://localhost:3001/api/v1` in development and `https://api.miwebprofesional.com/api/v1` in QA. All paths below are relative to it, except `/uploads/...`, which lives at the server root.
- JSON in and out (`Content-Type: application/json`), except the upload (multipart). JSON bodies may be up to **1 MB** (a blog post carries up to 100 000 characters of Markdown); larger bodies get **413**.
- Dates are ISO 8601 strings in UTC, e.g. `"2026-10-02T20:32:56.714Z"`.
- Ids are opaque strings (cuid). Never parse them.
- Unknown query parameters and unknown body properties are rejected with **400**: the API validates with `whitelist` and `forbidNonWhitelisted`. Send only the documented fields.

## Contents

1. [Conventions](#1-conventions): locales, errors, auth, caching, ordering
2. [Public endpoints](#2-public-endpoints): `GET /cases`, `GET /cases/:slug`, `GET /technologies`, `GET /services`, `GET /stats`
3. [Admin: cases](#3-admin-cases)
4. [Admin: technologies](#4-admin-technologies)
5. [Admin: services](#5-admin-services)
6. [Admin: uploads and `/uploads`](#6-uploads)
7. [Front revalidation webhook](#7-front-revalidation-webhook)
8. [Endpoint summary](#8-endpoint-summary)
9. [Blog](#9-blog): `GET /blog`, `GET /blog/:slug` and `/admin/blog`
10. [Assistant](#10-assistant): `POST /assistant/chat` (SSE), knowledge base, FAQs, conversations, settings and dashboard

---

## 1. Conventions

### Locales

| Where | Values | Example |
|---|---|---|
| Public endpoints (`?locale=`) | `es` \| `en` (lowercase, like the site URLs) | `GET /cases?locale=en` |
| Admin (keys and `locale` in bodies) | `ES` \| `EN` (uppercase) | `translations.ES`, `{ "locale": "EN" }` |

`?locale` is **required** on every public content endpoint. A missing or invalid locale returns 400; `ES` (uppercase) is also invalid there. Admin bodies also accept a lowercase `locale` (`"es"`) in publish and unpublish.

### Error format

Every error, from any endpoint, has this shape:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Caso no encontrado",
  "path": "/api/v1/cases/nope?locale=es",
  "timestamp": "2026-10-02T22:14:08.380Z"
}
```

- `message` is a `string`, or a `string[]` for validation errors (one entry per problem). Messages are in Spanish and safe to show in the admin.
- `details` appears on **422** (publication) errors and on the assistant's **429** (section 10). It is machine-readable, so the admin can highlight the fields:

```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "message": "No se puede publicar la versión ES. Falta: resumen, al menos un bloque",
  "details": { "locale": "ES", "missing": ["summary", "blocks"] },
  "path": "/api/v1/admin/cases/cmabc.../publish",
  "timestamp": "..."
}
```

| Status | When |
|---|---|
| 400 | Invalid query or body: wrong types, unknown properties, bad slug format, invalid blocks, unknown `technologyIds`, invalid reorder `ids`, invalid upload |
| 401 | Admin endpoint without a valid `Authorization: Bearer <accessToken>` |
| 403 | Authenticated, but the role is not allowed (every endpoint here allows `ADMIN` and `EDITOR`) |
| 404 | Unknown or soft-deleted id, or a slug that is not published in that locale |
| 409 | Slug or technology name already in use |
| 413 | Upload larger than 5 MB, or a JSON body larger than 1 MB |
| 422 | Publishing an incomplete translation, or editing a published translation so that it becomes incomplete |
| 429 | Rate limits: login (README) and the assistant chat (section 10) |
| 503 | The assistant has no Claude API key (section 10) |

### Auth

- **Public endpoints** (section 2 and `/uploads`): no auth.
- **Admin endpoints** (`/admin/...`): `Authorization: Bearer <accessToken>` from `POST /auth/login` or `POST /auth/refresh`. The roles `ADMIN` and `EDITOR` are both allowed everywhere in this document.

### Caching

- Successful public `GET`s return `Cache-Control: public, max-age=60`. Errors (400, 404) carry no `Cache-Control`.
- Admin responses carry no cache headers. Don't cache them.
- Uploaded files: `Cache-Control: public, max-age=31536000, immutable` (see section 6).
- The front should cache with tags and refresh them through the webhook (section 7).

### Ordering

Public lists are ordered by `sortOrder` ascending, then `createdAt` ascending. Admin lists use the same order unless you pass `sort`. The admin sets the order with `PUT /admin/<resource>/order` (positions 1..n).

The **blog** is the exception: it has no `sortOrder`. Posts are ordered by publication date, newest first (section 9).

### Soft delete

`DELETE` on cases, technologies, services and blog posts sets `deletedAt`. Deleted rows disappear from **every** endpoint: public and admin GETs return 404 for them and lists skip them. There is no restore endpoint yet. A deleted row keeps its slug (and a technology keeps its name), so reusing them gives **409** with a message that says the owner was deleted.

---

## 2. Public endpoints

These endpoints return published content only:

- A translation is visible only when its `status` is `PUBLISHED` and its parent is not deleted.
- Drafts are never visible, and neither are the ids of anything.
- `client` is never visible when `anonymizeClient` is true.

Technologies have no publish status: every non-deleted technology is public.

The public blog endpoints (`GET /blog`, `GET /blog/:slug`) follow the same rules; they are documented in [section 9](#9-blog).

### `GET /cases?locale=es|en[&type=...]`

| Query | Required | Values |
|---|---|---|
| `locale` | yes | `es` \| `en` |
| `type` | no | `SAAS` \| `ECOMMERCE` \| `WEB_CMS` \| `TOOL` \| `PLATFORM` (Home filters: SaaS, Ecommerce, Web + CMS, Herramientas, Plataforma) |

**200**

```json
{
  "data": [
    {
      "slug": "cortemaestro",
      "title": "CorteMaestro",
      "tagline": "NestJS · React · PostgreSQL",
      "summary": "Herramienta de despiece para carpinteros de melamina: del diseño del mueble a la lista de piezas y el plano de corte.",
      "type": "TOOL",
      "industry": "Carpintería",
      "year": 2026,
      "coverImageUrl": "http://localhost:3001/uploads/2026/10/4f1c...e2.webp",
      "technologies": [
        { "name": "NestJS", "slug": "nestjs" },
        { "name": "React", "slug": "react" }
      ]
    }
  ]
}
```

- `tagline`, `industry`, `year` and `coverImageUrl` may be `null`.
- `technologies` lists only non-deleted technologies, in the case's chip order. It may be `[]`.
- The list is not paginated.
- **400** for a missing or invalid `locale` or `type`, or any other query parameter.

### `GET /cases/:slug?locale=es|en`

The slug belongs to the requested locale: ES and EN slugs may differ.

**200**: every list field, plus:

```json
{
  "slug": "cortemaestro",
  "title": "CorteMaestro",
  "tagline": "NestJS · React · PostgreSQL",
  "summary": "Cutting-list tool for melamine carpenters: ...",
  "type": "TOOL",
  "industry": "Carpentry",
  "year": 2026,
  "coverImageUrl": null,
  "technologies": [{ "name": "NestJS", "slug": "nestjs" }],
  "client": "Producto propio",
  "blocks": [
    { "type": "text", "title": "The challenge", "body": "Melamine carpenters work out by hand...\n\nSecond paragraph." },
    {
      "type": "gallery",
      "images": [
        { "url": "http://localhost:3001/uploads/2026/10/a1b2....png", "alt": "Cutting plan" },
        { "url": "http://localhost:3001/uploads/2026/10/c3d4....webp", "alt": null }
      ],
      "caption": "Screens of the tool"
    },
    {
      "type": "metrics",
      "title": null,
      "items": [
        { "value": "18%", "label": "less board waste" },
        { "value": "5 min", "label": "per furniture cutting list" }
      ]
    }
  ],
  "seoTitle": "CorteMaestro · Case study | miwebprofesional",
  "seoDescription": "Cutting-list tool for melamine carpenters: ...",
  "publishedAt": "2026-10-02T20:32:56.714Z",
  "alternates": { "es": "cortemaestro", "en": "cortemaestro" },
  "next": { "slug": "ramos-de-girasoles", "title": "Ramos de Girasoles" }
}
```

| Field | Notes |
|---|---|
| `client` | `null` when the case is anonymised (`anonymizeClient`) or has no client |
| `blocks` | Ordered; render top to bottom. Text `body` is plain text; paragraphs are separated by a blank line (`\n\n`) |
| gallery block | `images` already resolved, with `alt` in the requested locale (`null` when not written; fall back to the case title, for example). `caption`: `string \| null` |
| metrics block | `title`: `string \| null`; `items` is never empty |
| dropped blocks | The API drops gallery blocks without images, metrics blocks without items and text blocks with an empty title and body. The front never receives empty blocks |
| `seoTitle`, `seoDescription` | `null` when not set. `seoDescription` is at most 160 characters. Fall back to `title` and `summary` |
| `publishedAt` | First publication of this locale; republishing keeps it |
| `alternates` | Slug of each locale, or `null` when that locale is **not published**. Use it for the language switch and `hreflang` |
| `next` | The next published case of this locale in public order, wrapping from the last case to the first. `null` when this is the only published case |

**404** `"Caso no encontrado"` when the slug does not exist in that locale, is a draft, or its case is deleted. **400** for an invalid or missing `locale`.

### `GET /technologies?locale=es|en[&featured=true|false]`

**200**

```json
{
  "data": [
    {
      "name": ".NET Core",
      "slug": "dotnet-core",
      "category": "BACKEND",
      "isFeatured": true,
      "description": "Plataforma de Microsoft para APIs y servicios."
    },
    { "name": "React", "slug": "react", "category": "FRONTEND", "isFeatured": false, "description": null }
  ]
}
```

- `category` is one of `FRONTEND`, `BACKEND`, `DATABASE`, `MOBILE`, `CLOUD`, `AI`, `OTHER`. The front translates the label.
- `description` is in the locale, or `null` when it is missing.
- `featured=true` returns the Home marquee; `featured=false` returns the rest; without it you get all of them. Any other value returns **400**.

### `GET /services?locale=es|en`

**200**: published services of the locale (Home accordion and `/servicios`). `slug` is the anchor on `/servicios`.

```json
{
  "data": [
    {
      "title": "Plataformas SaaS a medida",
      "slug": "plataformas-saas-a-medida",
      "description": "Multi-tenant, roles y permisos, facturación recurrente, paneles e integraciones con servicios locales.",
      "technologies": [
        { "name": ".NET Core", "slug": "dotnet-core" },
        { "name": "Laravel", "slug": "laravel" }
      ]
    }
  ]
}
```

### `GET /stats`

No query parameters. These figures feed the Home ("[N]+ proyectos entregados", and so on).

**200**

```json
{ "projects": 5, "technologies": 10, "industries": 5 }
```

| Field | Meaning |
|---|---|
| `projects` | Non-deleted cases published in at least one locale |
| `technologies` | Distinct non-deleted technologies used by those cases |
| `industries` | Distinct non-empty ES `industry` values of those cases (trimmed, case-insensitive) |

---

## 3. Admin: cases

Every admin endpoint requires `Authorization: Bearer <accessToken>` (`ADMIN` or `EDITOR`).

### Shapes

**AdminCase**: returned by GET, POST, PATCH, publish and unpublish:

```json
{
  "id": "cmurf6rhd0012msuq7ue6ckb5",
  "type": "TOOL",
  "client": "Producto propio",
  "anonymizeClient": false,
  "year": 2026,
  "coverImageUrl": null,
  "includeInKnowledgeBase": true,
  "sortOrder": 2,
  "technologyIds": ["cmtechnest...", "cmtechreact..."],
  "images": [
    {
      "id": "cmimg1...",
      "url": "http://localhost:3001/uploads/2026/10/a1b2....png",
      "alt": { "ES": "Plano de corte", "EN": null },
      "sortOrder": 1
    }
  ],
  "translations": {
    "ES": {
      "title": "CorteMaestro",
      "slug": "cortemaestro",
      "tagline": "NestJS · React · PostgreSQL",
      "summary": "Herramienta de despiece...",
      "industry": "Carpintería",
      "blocks": [
        { "type": "text", "title": "El reto", "body": "..." },
        { "type": "gallery", "imageIds": ["cmimg1..."], "caption": "Capturas" },
        { "type": "metrics", "items": [{ "value": "18%", "label": "menos desperdicio de tablero" }] }
      ],
      "seoTitle": "CorteMaestro · Caso de éxito | miwebprofesional",
      "seoDescription": "Herramienta de despiece...",
      "status": "PUBLISHED",
      "publishedAt": "2026-10-02T20:32:56.714Z"
    },
    "EN": null
  },
  "createdAt": "2026-10-02T20:32:56.700Z",
  "updatedAt": "2026-10-02T21:29:01.267Z"
}
```

- `translations.ES` and `translations.EN` are always present; a locale that does not exist yet is `null`.
- `status` is `DRAFT` \| `PUBLISHED`. Publication is **per locale**.
- `technologyIds` holds the non-deleted technologies in chip order.
- `images` is the gallery shared by both locales, ordered by `sortOrder`. Only `alt` is translated (`null` when not set).
- `blocks` are the raw stored blocks, with gallery `imageIds`. Optional keys (`caption`, metrics `title`) are omitted when unset.
- `updatedAt` changes on any edit of the case, its translations, images or technologies.

**Blocks** (`CaseBlock`, max **50** per translation):

| Type | Shape | Limits |
|---|---|---|
| text | `{ "type": "text", "title": string, "body": string }` | title ≤ 200, body ≤ 20 000. Both may be `""` while drafting |
| gallery | `{ "type": "gallery", "imageIds": string[], "caption"?: string }` | ≤ 50 ids, no repeats, **each id must be an image of this case** (`images[].id`). May be `[]` while drafting. caption ≤ 300 |
| metrics | `{ "type": "metrics", "title"?: string, "items": [{ "value": string, "label": string }] }` | ≤ 12 items, value ≤ 40, label ≤ 200. May be `[]` while drafting |

Any other key or type returns **400**. `message` then lists each problem with its path, for example `"blocks[1].imageIds[0] (\"cmx\") no es una imagen de este caso"`.

### `GET /admin/cases`

| Query | Default | Values |
|---|---|---|
| `page` | 1 | integer ≥ 1 |
| `limit` | 20 | 1–100 |
| `q` | | Case-insensitive search in the **titles of both locales** (≤ 200 characters) |
| `type` | | `SAAS` \| `ECOMMERCE` \| `WEB_CMS` \| `TOOL` \| `PLATFORM` |
| `status` | | `draft` \| `published`: matches when **any** locale has that status |
| `sort` | `sortOrder` | `sortOrder` \| `updatedAt` \| `title` (ES title, falling back to EN) |
| `order` | `asc` (`desc` for `updatedAt`) | `asc` \| `desc` |

**200**

```json
{
  "data": [
    {
      "id": "cmurf6rhd0012msuq7ue6ckb5",
      "type": "TOOL",
      "sortOrder": 2,
      "updatedAt": "2026-10-02T21:29:01.267Z",
      "coverImageUrl": null,
      "translations": {
        "ES": { "title": "CorteMaestro", "slug": "cortemaestro", "status": "PUBLISHED" },
        "EN": { "title": "CorteMaestro", "slug": "cortemaestro", "status": "DRAFT" }
      }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 5 }
}
```

Deleted cases are not listed. **400** for invalid query values.

### `GET /admin/cases/:id`

**200** AdminCase. **404** `"Caso no encontrado"` for an unknown or deleted id.

### `POST /admin/cases`

Minimal body: the admin creates the case and then opens its editor.

```json
{ "type": "TOOL", "translations": { "ES": { "title": "Diseño de muebles", "slug": "diseno-de-muebles" } } }
```

| Field | Rules |
|---|---|
| `type` | Required enum |
| `translations` | Object with `ES` and/or `EN`. **At least one** is required |
| `translations.<L>.title` | Required, trimmed, 1–200 characters |
| `translations.<L>.slug` | Optional. Format `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 120. When omitted it is generated from the title (`"Diseño de muebles"` becomes `diseno-de-muebles`), with `-2`, `-3`... added if that slug is taken in that locale |

Every other field gets its default: `summary: ""`, `blocks: []`, `client`, `year`, `cover`, `tagline`, `industry` and SEO set to `null`, `anonymizeClient: false`, `includeInKnowledgeBase: true`, and status `DRAFT`. `sortOrder` puts the case last.

**201** AdminCase. **400** for validation errors. **409** when an explicit slug is taken: `"El slug \"x\" ya está en uso en otro caso (ES)"`.

### `PATCH /admin/cases/:id`

A partial update: send only what changed. `null` clears a nullable field. Omitted fields stay as they are.

```json
{
  "type": "SAAS",
  "client": "Taller Pérez",
  "anonymizeClient": true,
  "year": 2026,
  "coverImageUrl": "http://localhost:3001/uploads/2026/10/cover.webp",
  "includeInKnowledgeBase": true,
  "sortOrder": 3,
  "technologyIds": ["cmtechnest...", "cmtechreact..."],
  "translations": {
    "ES": {
      "title": "CorteMaestro",
      "slug": "cortemaestro",
      "tagline": "NestJS · React",
      "summary": "...",
      "industry": "Carpintería",
      "blocks": [{ "type": "text", "title": "El reto", "body": "..." }],
      "seoTitle": "...",
      "seoDescription": "..."
    },
    "EN": { "title": "CorteMaestro" }
  }
}
```

| Field | Type | Nullable |
|---|---|---|
| `type` | enum | no |
| `client` | string ≤ 200 | yes |
| `anonymizeClient`, `includeInKnowledgeBase` | boolean | no |
| `year` | integer 1990–2100 | yes |
| `coverImageUrl` | http(s) URL ≤ 2048 (usually from `/admin/uploads`) | yes |
| `sortOrder` | integer ≥ 0 | no |
| `technologyIds` | string[] ≤ 50, no repeats, existing non-deleted technologies. **Replaces** the list in this chip order | no |
| `translations.<L>.title` | 1–200 | no |
| `translations.<L>.slug` | slug format ≤ 120 | no |
| `translations.<L>.summary` | ≤ 1000 (may be `""`) | no |
| `translations.<L>.tagline` | ≤ 200 | yes |
| `translations.<L>.industry` | ≤ 120 | yes |
| `translations.<L>.blocks` | CaseBlock[] ≤ 50, **replaces** the blocks | no |
| `translations.<L>.seoTitle` | ≤ 200 | yes |
| `translations.<L>.seoDescription` | ≤ 160 | yes |

- Strings are trimmed (except block contents). `""` in a nullable text field is stored as `null`.
- **A missing locale is created** as a `DRAFT` when `translations.<L>` is sent. `title` is then required (400 otherwise), and the slug is generated when omitted.
- **Editing a PUBLISHED translation keeps it published.** If the edit would leave it without a title, slug, summary or block, the request fails with **422** and nothing is saved: `"La versión ES está publicada y no puede quedar incompleta. Falta: resumen"`, with `details.missing`. Unpublish first if you really need to empty it.
- The update is atomic: on any error, nothing is saved.

**200** AdminCase. **400** for validation errors (including blocks and `technologyIds`). **404**. **409** when the slug is taken in that locale. **422** as described above.

### `POST /admin/cases/:id/publish` · `POST /admin/cases/:id/unpublish`

Body: `{ "locale": "ES" | "EN" }`

- **publish**: the locale must have a non-empty `title`, `slug`, `summary` and **at least one block**. Otherwise the request returns **422**: `"No se puede publicar la versión EN. Falta: título, resumen, al menos un bloque"` with `details: { locale, missing: ["title","slug","summary","blocks"] }`, where `missing` contains the API names of the missing fields. A locale that does not exist returns 422 listing all four fields. On success it sets `PUBLISHED` and sets `publishedAt` if it was not already set. Publishing an already published locale is idempotent.
- **unpublish**: sets `DRAFT` and keeps `publishedAt`. **404** when the locale does not exist.

**200** AdminCase. **400** for an invalid locale. **404** for an unknown case.

### `DELETE /admin/cases/:id`

Soft delete. **204** with no body. **404** for an unknown or already deleted id.

### `PUT /admin/cases/order`

Body: `{ "ids": ["<id>", "..."] }`. It must contain **every non-deleted case id exactly once**, in the new order; the API sets `sortOrder` to 1..n. **204**. **400** for missing, unknown, deleted or repeated ids; the message lists them.

### Images

Upload the file first (section 6), then attach its URL to the case.

| Method and path | Body | Response |
|---|---|---|
| `POST /admin/cases/:id/images` | `{ "url": "http(s)://...", "alt"?: { "ES"?: string \| null, "EN"?: string \| null } }` | **201** `{ "id", "url", "alt": { "ES", "EN" }, "sortOrder" }`, added at the end |
| `PATCH /admin/cases/:id/images/:imageId` | `{ "alt"?: { "ES"?, "EN"? }, "sortOrder"?: integer ≥ 0 }` | **200** image. In `alt`, omitted locales are kept and `null` or `""` clears a locale |
| `DELETE /admin/cases/:id/images/:imageId` | none | **204**. Also removes the id from **every gallery block of every locale** of the case |

- `alt` is at most 300 characters per locale; `url` is at most 2048.
- **404** `"Imagen no encontrada"` when the image does not belong to that case. **404** `"Caso no encontrado"` for an unknown case.
- Deleting an image does not delete the file from storage.

---

## 4. Admin: technologies

**AdminTechnology**

```json
{
  "id": "cmtech...",
  "name": "Next.js",
  "slug": "nextjs",
  "category": "FRONTEND",
  "isFeatured": true,
  "sortOrder": 3,
  "descriptions": { "ES": "Framework de React", "EN": null },
  "usage": { "cases": 2, "services": 1 }
}
```

`usage` counts the non-deleted cases and services linked to the technology.

| Method and path | Body | Response |
|---|---|---|
| `GET /admin/technologies` | none | **200** `{ "data": AdminTechnology[] }`: all non-deleted technologies, not paginated, in order |
| `GET /admin/technologies/:id` | none | **200** AdminTechnology · **404** |
| `POST /admin/technologies` | `{ "name": string, "slug"?: string, "category"?: enum, "isFeatured"?: boolean, "descriptions"?: { "ES"?: string \| null, "EN"?: string \| null } }` | **201** AdminTechnology |
| `PATCH /admin/technologies/:id` | Any of `name`, `slug`, `category`, `isFeatured`, `sortOrder`, `descriptions` | **200** AdminTechnology |
| `DELETE /admin/technologies/:id` | none | **204** (soft) |
| `PUT /admin/technologies/order` | `{ "ids": string[] }` (every non-deleted id) | **204** |

- `name` is a proper noun and is not translated; 1–80 characters, **unique regardless of case**. `slug` is generated from the name when omitted (`".NET Core"` becomes `net-core`). `category` defaults to `OTHER`, `isFeatured` to `false`, and new technologies go last.
- `descriptions`: each at most 1000 characters. Omitted locales are kept; `null` or `""` clears one.
- **409** for a duplicate name or slug, for example `"Ya existe una tecnología llamada \"Next.js\""` or `"El slug \"nextjs\" ya está en uso en otra tecnología"`.
- **Deleting a technology in use is allowed.** The case and service links stay in the database, but the technology disappears from public chips, `/technologies` and `/stats`, and from `technologyIds` in the admin. The next PATCH of `technologyIds` on those cases drops the link.

---

## 5. Admin: services

**AdminService**

```json
{
  "id": "cmsvc...",
  "sortOrder": 1,
  "technologyIds": ["cmtech..."],
  "translations": {
    "ES": {
      "title": "Plataformas SaaS a medida",
      "slug": "plataformas-saas-a-medida",
      "description": "Multi-tenant, roles y permisos...",
      "status": "PUBLISHED",
      "publishedAt": "2026-10-02T20:32:56.640Z"
    },
    "EN": null
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

| Method and path | Body | Response |
|---|---|---|
| `GET /admin/services` | none | **200** `{ "data": AdminService[] }`: non-deleted services, not paginated, in order |
| `GET /admin/services/:id` | none | **200** · **404** `"Servicio no encontrado"` |
| `POST /admin/services` | `{ "technologyIds"?: string[], "translations": { "ES"?: { "title", "slug"?, "description"? }, "EN"?: {...} } }`, at least one locale | **201**. Every locale starts as a `DRAFT`. `description` defaults to `""`; the slug is generated when omitted |
| `PATCH /admin/services/:id` | `{ "sortOrder"?, "technologyIds"?, "translations"?: { "ES"?: { "title"?, "slug"?, "description"? }, "EN"?: ... } }` | **200**. Creates a missing locale (it needs `title`) |
| `POST /admin/services/:id/publish` | `{ "locale": "ES" \| "EN" }` | **200** · **422** when `title`, `slug` or `description` is missing (`"No se puede publicar la versión ES. Falta: descripción"`, plus `details`) |
| `POST /admin/services/:id/unpublish` | `{ "locale" }` | **200** · **404** when the locale does not exist |
| `DELETE /admin/services/:id` | none | **204** (soft) |
| `PUT /admin/services/order` | `{ "ids": string[] }` | **204** |

- `title` is 1–200 characters and `description` at most 2000. The slug is unique per locale (**409**).
- A published translation cannot be left incomplete (**422**), as with cases.
- `technologyIds` replaces the list in the given order (**400** for unknown or deleted ids).

---

## 6. Uploads

### `POST /admin/uploads`

`multipart/form-data` with **one** file in the field **`file`**. Auth: `ADMIN` or `EDITOR`.

```bash
curl -X POST http://localhost:3001/api/v1/admin/uploads \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@portada.webp"
```

**201**

```json
{
  "url": "http://localhost:3001/uploads/2026/10/47c6ae4568f1e2889f15c2901f936fcf.webp",
  "contentType": "image/webp",
  "size": 48213
}
```

| Rule | Detail |
|---|---|
| Formats | JPEG, PNG, WebP, AVIF. The type is detected from the **file's bytes** (magic numbers); the filename and the declared mimetype are ignored. SVG, GIF and HEIC are rejected |
| Size | Max **5 MB** (5 242 880 bytes) |
| Name | Random (128 bits), with the extension of the detected type, under `<yyyy>/<mm>/` (UTC). Files are never overwritten |
| Errors | **400** `"Formato no permitido. Sube una imagen JPEG, PNG, WebP o AVIF."` · **400** `"Falta la imagen: envíala como multipart/form-data en el campo \"file\""` · **400** for another field name or more than one file · **413** `"La imagen supera el tamaño máximo de 5 MB"` · **401** / **403** |

Use the returned `url` as `coverImageUrl` (PATCH case) or as the `url` of `POST /admin/cases/:id/images`.

### `GET /uploads/<yyyy>/<mm>/<file>` (public)

This path is outside `/api`, at the server root, for example `http://localhost:3001/uploads/2026/10/47c6....webp`.

- Response headers:
  - `Cache-Control: public, max-age=31536000, immutable`
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy: default-src 'none'`
  - `Cross-Origin-Resource-Policy: cross-origin`
  - `ETag` and `Last-Modified`
- The API doesn't list directories or serve index files or dotfiles, and nothing outside the uploads directory is reachable. Misses return 404; this 404 is Express's plain HTML page, not the JSON error format.
- **front-mwp / admin-mwp:** if you use `next/image`, allow the host of `PUBLIC_UPLOADS_URL` in `images.remotePatterns`: `http://localhost:3001/uploads/**` in development and `https://api.miwebprofesional.com/uploads/**` in QA.

---

## 7. Front revalidation webhook

After every successful admin mutation that can change public content, the API calls front-mwp:

```http
POST ${FRONT_REVALIDATE_URL}          (dev: http://localhost:3000/api/revalidate)
Content-Type: application/json
x-revalidate-secret: ${REVALIDATE_SECRET}

{ "tags": ["cases", "stats", "case:cortemaestro", "case:corte-maestro"] }
```

- **Fire-and-forget.** The call happens after the database commit, with a **3 s timeout** and no retries. A failure or non-2xx answer is only logged; the admin request never fails or waits for it. The call is skipped when `FRONT_REVALIDATE_URL` is unset.
- `tags` are unique and in no particular order.
- **What the front must do:**
  - Compare `x-revalidate-secret` with its own `REVALIDATE_SECRET` in constant time. Answer **401** if it doesn't match.
  - Call `revalidateTag(tag)` for each tag.
  - Answer **200** quickly.
  - Ignore unknown tags, since more tags may be added later.

### Tags

| Tag | Tag these fetches with it |
|---|---|
| `cases` | `GET /cases` (list) **and** every `GET /cases/:slug`, because the detail embeds `next` and chips that depend on other cases and on technologies |
| `case:<slug>` | `GET /cases/<slug>` (the same tag in both locales; ES and EN slugs may differ) |
| `technologies` | `GET /technologies` |
| `services` | `GET /services` |
| `stats` | `GET /stats` |
| `blog` | `GET /blog` (every page) **and** every `GET /blog/:slug`, because the detail embeds `previous`/`next` and chips that depend on other posts and on technologies |
| `post:<slug>` | `GET /blog/<slug>` (the same tag in both locales; ES and EN slugs may differ) |

### Tags sent per mutation

| Mutation | Tags |
|---|---|
| `PATCH /admin/cases/:id`, publish, unpublish, `DELETE`, image POST/PATCH/DELETE | `cases`, `stats`, and `case:<slug>` for **every** slug of the case (both locales, any status). On a slug change, both the old and the new slug are sent |
| `PUT /admin/cases/order` | `cases`, `stats` |
| `POST /admin/cases` | none (a new case is a draft) |
| `POST /admin/technologies`, `PUT /admin/technologies/order` | `technologies` |
| `PATCH /admin/technologies/:id`, `DELETE /admin/technologies/:id` | `technologies`, `cases`, `services`, `stats`, `blog` (names and slugs appear in chips; deletion changes the stats) |
| `PATCH /admin/services/:id`, publish, unpublish, `DELETE`, `PUT /admin/services/order` | `services` |
| `POST /admin/services` | none (draft) |
| `PATCH /admin/blog/:id` (any field: text, slug, cover, technologies), publish, unpublish, `DELETE` | `blog` and `post:<slug>` for **every** slug of the post (both locales, any status). On a slug change, both the old and the new slug are sent |
| `POST /admin/blog` | none (a new post is a draft) |

### Environment

| Variable | Where | Value |
|---|---|---|
| `FRONT_REVALIDATE_URL` | api-mwp | `http://localhost:3000/api/revalidate` in dev; empty disables the webhook |
| `REVALIDATE_SECRET` | api-mwp **and** front-mwp (same value) | Random, at least 32 characters. The API refuses to start if the URL is set without it |

---

## 8. Endpoint summary

| Method | Path | Auth | Success |
|---|---|---|---|
| GET | `/cases?locale&type` | public | 200 `{ data }` |
| GET | `/cases/:slug?locale` | public | 200 detail |
| GET | `/technologies?locale&featured` | public | 200 `{ data }` |
| GET | `/services?locale` | public | 200 `{ data }` |
| GET | `/stats` | public | 200 |
| GET | `/blog?locale&page&limit` | public | 200 `{ data, meta }` |
| GET | `/blog/:slug?locale` | public | 200 detail |
| GET | `/admin/cases` | ADMIN, EDITOR | 200 `{ data, meta }` |
| GET | `/admin/cases/:id` | ADMIN, EDITOR | 200 |
| POST | `/admin/cases` | ADMIN, EDITOR | 201 |
| PATCH | `/admin/cases/:id` | ADMIN, EDITOR | 200 |
| POST | `/admin/cases/:id/publish` | ADMIN, EDITOR | 200 |
| POST | `/admin/cases/:id/unpublish` | ADMIN, EDITOR | 200 |
| DELETE | `/admin/cases/:id` | ADMIN, EDITOR | 204 |
| PUT | `/admin/cases/order` | ADMIN, EDITOR | 204 |
| POST | `/admin/cases/:id/images` | ADMIN, EDITOR | 201 |
| PATCH | `/admin/cases/:id/images/:imageId` | ADMIN, EDITOR | 200 |
| DELETE | `/admin/cases/:id/images/:imageId` | ADMIN, EDITOR | 204 |
| GET | `/admin/technologies` | ADMIN, EDITOR | 200 `{ data }` |
| GET | `/admin/technologies/:id` | ADMIN, EDITOR | 200 |
| POST | `/admin/technologies` | ADMIN, EDITOR | 201 |
| PATCH | `/admin/technologies/:id` | ADMIN, EDITOR | 200 |
| DELETE | `/admin/technologies/:id` | ADMIN, EDITOR | 204 |
| PUT | `/admin/technologies/order` | ADMIN, EDITOR | 204 |
| GET | `/admin/services` | ADMIN, EDITOR | 200 `{ data }` |
| GET | `/admin/services/:id` | ADMIN, EDITOR | 200 |
| POST | `/admin/services` | ADMIN, EDITOR | 201 |
| PATCH | `/admin/services/:id` | ADMIN, EDITOR | 200 |
| POST | `/admin/services/:id/publish` | ADMIN, EDITOR | 200 |
| POST | `/admin/services/:id/unpublish` | ADMIN, EDITOR | 200 |
| DELETE | `/admin/services/:id` | ADMIN, EDITOR | 204 |
| PUT | `/admin/services/order` | ADMIN, EDITOR | 204 |
| POST | `/admin/uploads` | ADMIN, EDITOR | 201 `{ url, contentType, size }` |
| GET | `/admin/blog` | ADMIN, EDITOR | 200 `{ data, meta }` |
| GET | `/admin/blog/:id` | ADMIN, EDITOR | 200 |
| POST | `/admin/blog` | ADMIN, EDITOR | 201 |
| PATCH | `/admin/blog/:id` | ADMIN, EDITOR | 200 |
| POST | `/admin/blog/:id/publish` | ADMIN, EDITOR | 200 |
| POST | `/admin/blog/:id/unpublish` | ADMIN, EDITOR | 200 |
| DELETE | `/admin/blog/:id` | ADMIN, EDITOR | 204 |
| GET | `/uploads/<path>` (no `/api` prefix) | public | 200 file |
| POST | `/assistant/chat` | public (10/min per IP and visitor) | 200 SSE |
| GET | `/admin/conversations` | ADMIN, EDITOR | 200 `{ data, meta }` |
| GET | `/admin/conversations/:id` | ADMIN, EDITOR | 200 |
| GET | `/admin/assistant/settings` | ADMIN, EDITOR | 200 |
| PUT | `/admin/assistant/settings` | ADMIN, EDITOR | 200 |
| POST | `/admin/assistant/test` | ADMIN, EDITOR | 200 |
| GET | `/admin/assistant/unanswered?days` | ADMIN, EDITOR | 200 |
| GET | `/admin/knowledge/status` | ADMIN, EDITOR | 200 |
| POST | `/admin/knowledge/reindex` | ADMIN, EDITOR | 202 |
| GET | `/admin/faqs` | ADMIN, EDITOR | 200 `{ data, meta }` |
| GET | `/admin/faqs/:id` | ADMIN, EDITOR | 200 |
| POST | `/admin/faqs` | ADMIN, EDITOR | 201 |
| PATCH | `/admin/faqs/:id` | ADMIN, EDITOR | 200 |
| POST | `/admin/faqs/:id/publish` | ADMIN, EDITOR | 200 |
| POST | `/admin/faqs/:id/unpublish` | ADMIN, EDITOR | 200 |
| DELETE | `/admin/faqs/:id` | ADMIN, EDITOR | 204 |
| GET | `/admin/stats/overview?days` | ADMIN, EDITOR | 200 |

---

## 9. Blog

Markdown posts, bilingual and published **per locale**, like cases. Each post has a cover, an author (the user who created it) and technology chips shared by both locales. Added in Phase 3.6; the seed loads the initial posts from Markdown files (see the README).

### `GET /blog?locale=es|en[&page=1&limit=12]` (public)

| Query | Required | Values |
|---|---|---|
| `locale` | yes | `es` \| `en` |
| `page` | no | integer ≥ 1, default 1 |
| `limit` | no | 1–50, default **12** |

**200** (`Cache-Control: public, max-age=60`)

```json
{
  "data": [
    {
      "slug": "lo-que-cambio-en-nextjs-16",
      "title": "Lo que cambió en Next.js 16: proxy.ts, params asíncronos y caché por etiquetas",
      "excerpt": "Qué cambió al migrar este sitio a Next.js 16...",
      "coverImageUrl": "http://localhost:3001/uploads/2026/10/4f1c...e2.webp",
      "publishedAt": "2026-09-12T00:00:00.000Z",
      "readingMinutes": 6,
      "author": { "name": "Wile" },
      "technologies": [
        { "name": "Next.js", "slug": "nextjs" },
        { "name": "React", "slug": "react" }
      ]
    }
  ],
  "meta": { "page": 1, "limit": 12, "total": 6 }
}
```

- Only translations **published in that locale** of non-deleted posts. A post published only in ES does not appear in `?locale=en`.
- Order: `publishedAt` descending (newest first), then the post's `createdAt` descending.
- `publishedAt` is the first publication of this locale (republishing keeps it). Seeded posts carry the date of their file.
- `readingMinutes` is computed by the API from the Markdown: `ceil(words / 200)`, at least 1. Fenced code blocks (backtick or tilde fences), HTML tags, link and image targets, bare URLs and markup characters are not counted; link texts, image alt texts and inline code are.
- `author` is `null` when the author's user no longer exists. `coverImageUrl` may be `null`. `technologies` lists non-deleted technologies in chip order (may be `[]`).
- A page past the end returns `data: []` with the real `total`.
- **400** for a missing or invalid `locale`, `page < 1`, `limit` outside 1–50, or any other query parameter.

### `GET /blog/:slug?locale=es|en` (public)

The slug belongs to the requested locale.

**200**: every list field, plus:

```json
{
  "slug": "lo-que-cambio-en-nextjs-16",
  "title": "Lo que cambió en Next.js 16: proxy.ts, params asíncronos y caché por etiquetas",
  "excerpt": "...",
  "coverImageUrl": null,
  "publishedAt": "2026-09-12T00:00:00.000Z",
  "readingMinutes": 6,
  "author": { "name": "Wile" },
  "technologies": [{ "name": "Next.js", "slug": "nextjs" }],
  "content": "## Por qué migramos\n\nNext.js 16 renombra `middleware.ts` a `proxy.ts`...\n\n```ts\nexport function proxy(request: NextRequest) { ... }\n```",
  "updatedAt": "2026-10-04T18:20:11.512Z",
  "seoTitle": null,
  "seoDescription": "Qué cambió en Next.js 16 y cómo lo aplicamos en un sitio real.",
  "alternates": { "es": "lo-que-cambio-en-nextjs-16", "en": "what-changed-in-nextjs-16" },
  "previous": { "slug": "nestjs-12-prisma-7-con-esm", "title": "NestJS 12 + Prisma 7 con ESM: cómo arrancamos una API" },
  "next": null
}
```

| Field | Notes |
|---|---|
| `content` | **Raw Markdown** (GFM: tables, fenced code with a language). Render it on the server and **do not allow raw HTML** in it |
| `updatedAt` | Last edit of the post (text of any locale, cover, technologies, publication). Use it as `dateModified` |
| `seoTitle`, `seoDescription` | `null` when not set. `seoDescription` ≤ 160 characters. Fall back to `title` and `excerpt` |
| `alternates` | Slug of each locale, or `null` when that locale is **not published**. Use it for the language switch and `hreflang` |
| `previous` | The next **older** published post of this locale, or `null` for the oldest |
| `next` | The next **newer** published post of this locale, or `null` for the newest. There is no wraparound |

**404** `"Artículo no encontrado"` when the slug does not exist in that locale, is a draft, or its post is deleted. **400** for a missing or invalid `locale`.

### Admin shapes

**AdminBlogPost**: returned by `GET /admin/blog/:id`, POST, PATCH, publish and unpublish:

```json
{
  "id": "cmuud0ig00006akuqbarhwbwz",
  "coverImageUrl": "http://localhost:3001/uploads/2026/10/cover.webp",
  "technologyIds": ["cmtechnext...", "cmtechreact..."],
  "author": { "name": "Wile" },
  "translations": {
    "ES": {
      "title": "Lo que cambió en Next.js 16",
      "slug": "lo-que-cambio-en-nextjs-16",
      "excerpt": "Qué cambió al migrar este sitio...",
      "content": "## Por qué migramos\n\n...",
      "seoTitle": null,
      "seoDescription": "Qué cambió en Next.js 16...",
      "status": "PUBLISHED",
      "publishedAt": "2026-09-12T00:00:00.000Z"
    },
    "EN": null
  },
  "createdAt": "2026-10-04T18:00:00.000Z",
  "updatedAt": "2026-10-04T18:20:11.512Z"
}
```

- `translations.ES` / `translations.EN` are always present; a missing locale is `null`. `excerpt`, `seoTitle` and `seoDescription` may be `null`; `content` is `""` until written.
- `author` is `null` when the user no longer exists. It is set on creation and never changes.
- `technologyIds`: non-deleted technologies, in chip order.

### `GET /admin/blog`

| Query | Default | Values |
|---|---|---|
| `page` | 1 | integer ≥ 1 |
| `limit` | 20 | 1–100 |
| `q` | | Case-insensitive search in the **titles of both locales** (≤ 200 characters) |
| `status` | | `draft` \| `published`: matches when **any** locale has that status |
| `sort` | `updatedAt` | `updatedAt` \| `publishedAt` \| `title`. `title` and `publishedAt` use the ES value, falling back to EN. With `publishedAt`, posts never published go **last** in both directions |
| `order` | `desc` (`asc` for `title`) | `asc` \| `desc` |

**200**

```json
{
  "data": [
    {
      "id": "cmuud0ig00006akuqbarhwbwz",
      "coverImageUrl": null,
      "updatedAt": "2026-10-04T18:20:11.512Z",
      "author": { "name": "Wile" },
      "translations": {
        "ES": { "title": "Lo que cambió en Next.js 16", "slug": "lo-que-cambio-en-nextjs-16", "status": "PUBLISHED", "publishedAt": "2026-09-12T00:00:00.000Z" },
        "EN": { "title": "What changed in Next.js 16", "slug": "what-changed-in-nextjs-16", "status": "DRAFT", "publishedAt": null }
      }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 6 }
}
```

Deleted posts are not listed. **400** for invalid query values.

### `GET /admin/blog/:id`

**200** AdminBlogPost. **404** `"Artículo no encontrado"` for an unknown or deleted id.

### `POST /admin/blog`

Minimal body: the admin creates the post and then opens its editor.

```json
{ "translations": { "ES": { "title": "Sesiones seguras en Next.js", "slug": "sesiones-seguras-en-nextjs" } } }
```

| Field | Rules |
|---|---|
| `translations` | Object with `ES` and/or `EN`. **At least one** is required. No other top-level field is accepted |
| `translations.<L>.title` | Required, trimmed, 1–200 characters |
| `translations.<L>.slug` | Optional. Format `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 120. Generated from the title when omitted (`-2`, `-3`... if taken in that locale) |

The author is the authenticated user. Every locale starts as a `DRAFT` with `excerpt: null`, `content: ""` and no SEO; no cover and no technologies.

**201** AdminBlogPost. **400** for validation errors. **409** when an explicit slug is taken: `"El slug \"x\" ya está en uso en otro artículo (ES)"`, or `"El slug \"x\" (ES) lo usa un artículo eliminado; elige otro"`.

### `PATCH /admin/blog/:id`

Partial update: send only what changed. `null` clears a nullable field; omitted fields stay as they are.

```json
{
  "coverImageUrl": "http://localhost:3001/uploads/2026/10/cover.webp",
  "technologyIds": ["cmtechnext...", "cmtechreact..."],
  "translations": {
    "ES": {
      "title": "Lo que cambió en Next.js 16",
      "slug": "lo-que-cambio-en-nextjs-16",
      "excerpt": "Qué cambió al migrar este sitio...",
      "content": "## Por qué migramos\n\n...",
      "seoTitle": null,
      "seoDescription": "Qué cambió en Next.js 16..."
    },
    "EN": { "title": "What changed in Next.js 16" }
  }
}
```

| Field | Type | Nullable |
|---|---|---|
| `coverImageUrl` | http(s) URL ≤ 2048 (usually from `/admin/uploads`) | yes |
| `technologyIds` | string[] ≤ 20, no repeats, existing non-deleted technologies. **Replaces** the list in this chip order | no |
| `translations.<L>.title` | 1–200 | no |
| `translations.<L>.slug` | slug format ≤ 120 | no |
| `translations.<L>.excerpt` | ≤ 500 | yes |
| `translations.<L>.content` | Markdown, ≤ **100 000** characters (may be `""`). Stored as sent: **not trimmed** | no |
| `translations.<L>.seoTitle` | ≤ 200 | yes |
| `translations.<L>.seoDescription` | ≤ 160 | yes |

- Strings are trimmed (except `content`). `""` in a nullable field is stored as `null`.
- **A missing locale is created** as a `DRAFT` when `translations.<L>` is sent; `title` is then required (400 otherwise) and the slug is generated when omitted.
- **Editing a PUBLISHED translation keeps it published**, so it must stay complete: if the edit would leave it without title, slug, excerpt or content, the request fails with **422** and nothing is saved: `"La versión ES está publicada y no puede quedar incompleta. Falta: contenido"` with `details: { "locale": "ES", "missing": ["content"] }`. Unpublish first to empty it.
- The update is atomic: on any error, nothing is saved.

**200** AdminBlogPost. **400** for validation errors (including unknown `technologyIds`). **404**. **409** when the slug is taken in that locale. **413** `"El cuerpo de la petición es demasiado grande"` when the JSON body exceeds 1 MB. **422** as described above.

### `POST /admin/blog/:id/publish` · `POST /admin/blog/:id/unpublish`

Body: `{ "locale": "ES" | "EN" }` (lowercase also accepted).

- **publish**: the locale needs a non-empty `title`, `slug`, `excerpt` and `content`. Otherwise **422** `"No se puede publicar la versión EN. Falta: extracto, contenido"` with `details: { "locale": "EN", "missing": ["excerpt", "content"] }`. `missing` uses the API names (`title`, `slug`, `excerpt`, `content`); the message uses the Spanish labels (título, slug, extracto, contenido). A locale that does not exist returns 422 listing all four. On success the locale becomes `PUBLISHED`, and `publishedAt` is set **only the first time**. Publishing an already published locale is idempotent.
- **unpublish**: sets `DRAFT` and keeps `publishedAt`. **404** `"El artículo no tiene versión EN"` when the locale does not exist.

**200** AdminBlogPost. **400** for an invalid locale. **404** for an unknown post.

### `DELETE /admin/blog/:id`

Soft delete. **204** with no body. **404** for an unknown or already deleted id. The slugs stay reserved (**409** if reused).

### Revalidation

Every blog mutation except `POST /admin/blog` sends `blog` plus `post:<slug>` for every slug of the post (old and new on a slug change); see [section 7](#7-front-revalidation-webhook). The front should tag `GET /blog` with `blog`, and `GET /blog/:slug` with both `blog` and `post:<slug>`.

---

## 10. Assistant

Phase 4: the AI assistant of the public site and its admin screens. The visitor asks in the hero input, the drawer or the chat embedded in a case page; the API answers with **Claude Sonnet 5.5** over **Server-Sent Events**, using only the knowledge base (published cases and FAQs), citing its sources, and turning interest into leads and meetings.

| Piece | What it is |
|---|---|
| Knowledge base | Chunks of every **published** case translation with `includeInKnowledgeBase = true`, and of every published FAQ translation, **per locale**, embedded with Voyage AI (`voyage-3.5`, 1024 dimensions) in pgvector. Anonymised clients (`anonymizeClient`) are never indexed, not even inside the text. Kept in sync automatically (10.6) |
| Chat | `POST /assistant/chat` (public), streaming SSE (10.1–10.3) |
| Tools of the model | `buscar_casos` (search), `crear_lead` (lead with source `CHAT_IA`), `agendar_reunion` (Google Calendar or a meeting request) (10.4) |
| Admin | Conversations, assistant settings, "Probar pregunta", FAQs, knowledge status and reindex, unanswered questions, dashboard stats (10.7–10.11) |

### 10.1 `POST /assistant/chat` (public)

The browser calls it **directly** (`${NEXT_PUBLIC_API_URL}/api/v1/assistant/chat`); CORS allows the origins in `CORS_ORIGINS` (front-mwp `http://localhost:3000` in dev). `EventSource` cannot send a POST body, so use `fetch` and read the body stream (example in 10.3).

**Request** (`Content-Type: application/json`):

```json
{
  "conversationId": "cmwvjm3l80001j0uq2dua9dtw",
  "visitorId": "5f0c2b7e-8a7d-4a51-9b6e-0d3c7d8e2a10",
  "locale": "es",
  "message": "¿Tienen experiencia con sistemas para contadores?",
  "caseSlug": "contaflow-ia"
}
```

| Field | Required | Rules |
|---|---|---|
| `conversationId` | no | Omit it (or send `null`) for the first message; the first SSE event returns the new id. Send it back with every next message. Format: lowercase letters and digits, 10–40 characters (a cuid) |
| `visitorId` | yes | Random id generated **once per browser** (e.g. `crypto.randomUUID()`, kept in `localStorage`). 8–64 characters: letters, digits, `-`, `_`. A conversation only accepts the visitor that started it |
| `locale` | yes | `es` \| `en` (lowercase, the site locale). The assistant answers in the language the visitor writes in, falling back to this one; the knowledge of this locale is searched first |
| `message` | yes | Trimmed, 1–1000 characters |
| `caseSlug` | no | Slug **in `locale`** of the case page the chat is embedded in ("La IA conoce este proyecto"). The assistant knows which case "este proyecto" means, and that case's chunks are boosted in the search. An unknown or unpublished slug is ignored (no error) |

Any other property is rejected with **400** (like every endpoint).

**Errors before the stream starts** are plain JSON in the shared error format (section 1), so check `response.ok` (and `Content-Type`) before reading the stream:

| Status | When | `message` / `details` |
|---|---|---|
| 400 | Invalid body | `message` is a `string[]` (Spanish, like every validation error) |
| 404 | `conversationId` unknown, or it belongs to another `visitorId` | `"Conversación no encontrada"` / `"Conversation not found"` (by `locale`). Start a new conversation (drop the stored id) |
| 429 | More than **10 messages per minute** from the same IP **or** the same `visitorId` | `"Demasiados mensajes seguidos. Espera un minuto y vuelve a intentarlo."` / `"Too many messages in a row. Wait a minute and try again."`; `details: { "reason": "rate_limit" }`; `Retry-After` header (seconds) |
| 429 | The conversation already has `maxMessagesPerSession` visitor messages (setting, default 20) | `"Has alcanzado el límite de 20 mensajes en esta conversación. …"` / English; `details: { "reason": "session_limit", "limit": 20 }`. Offer the contact form; a new conversation starts the count again |
| 503 | The API has no `ANTHROPIC_API_KEY` | `"El asistente no está disponible en este momento. Inténtalo de nuevo en unos minutos."` / English |

```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "You have reached the limit of 20 messages in this conversation. If you want to continue, write to us from the contact page and we will get back to you.",
  "details": { "reason": "session_limit", "limit": 20 },
  "path": "/api/v1/assistant/chat",
  "timestamp": "2026-11-25T03:07:20.118Z"
}
```

> Rate limiting is in memory, per API instance. Behind Apache every request reaches the API from `127.0.0.1` until `trust proxy` is configured (Phase 7), so until then the per-IP limit is shared by everybody and the **per-`visitorId`** limit is the effective one per visitor. Keep the `visitorId` stable per browser.

### 10.2 SSE response

**200** with these headers:

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store
X-Accel-Buffering: no
Connection: keep-alive
```

The body is a sequence of events. Each event is `event: <name>`, one `data: <JSON>` line and a blank line. Lines starting with `:` are **keep-alive comments**, sent every 15 s: ignore them.

| Event | `data` | When |
|---|---|---|
| `conversation` | `{ "conversationId": string }` | Always **first**. Store the id for the next messages |
| `tool` | `{ "name": "buscar_casos" \| "crear_lead" \| "agendar_reunion", "status": "started" \| "completed" \| "failed" }` | Zero or more, around each tool call (a `started` is always followed by `completed` or `failed`). Use it for "Buscando en los casos…", "Registrando tus datos…", "Revisando la agenda…" |
| `delta` | `{ "text": string }` | Answer text to **append**, in order. Simple Markdown (bold, lists, paragraphs separated by `\n\n`; no headings or tables). Citation markers are already removed |
| `lead` | `{ "created": boolean }` | The visitor's contact data was stored (`true` = new lead, `false` = the lead of this conversation was updated) |
| `meeting` | `{ "status": "BOOKED" \| "REQUESTED", "start": string, "meetLink": string \| null }` | `BOOKED`: created in Google Calendar, the visitor gets the invitation; `meetLink` is the Google Meet URL. `REQUESTED`: stored for the team to confirm by email (`meetLink: null`). `start` is ISO 8601 UTC: format it in the visitor's zone. Not sent when the slot was unavailable (the answer then proposes alternatives) |
| `sources` | `[{ "sourceKey": string, "title": string, "url": string \| null }]` | Exactly once, right before `done` (may be `[]`). The cited sources, one per case or FAQ, in citation order: "Caso citado" / "Fuentes usadas" |
| `done` | `{ "messageId": string, "stopReason": string, "unanswered": boolean, "content": string, "usage": Usage }` | **Last** event of a successful turn |
| `error` | `{ "message": string }` | **Last** event when the turn failed after the stream started (Claude API down, overloaded…). The message is in the visitor's locale and safe to show. No `sources`/`done` follow |

Rules for the front:

- A stream ends with **exactly one** of `done` or `error`. If the connection closes without either, treat it as an error.
- `tool`, `lead` and `meeting` may arrive between `delta` events. Don't assume a fixed order except: `conversation` first, then `sources` and `done` last.
- `done.content` is the final answer as stored (the concatenated deltas, trimmed). **When `done.stopReason` is `"refusal"`, replace the bubble with `done.content`** (a friendly "I can't help with that" message): any text streamed before the refusal was discarded.
- `done.unanswered: true` means the knowledge base had nothing relevant; the answer already offers to talk to the team. You may show the contact / "agendar llamada" actions more prominently.
- `sources[].url` is a **path on front-mwp** (`/es/casos/contaflow-ia`, `/en/casos/contaflow-ia`); use it in `<Link>`. FAQs have `url: null` (there is no FAQ page): show them as plain text. `sourceKey` starts with `caso:` or `faq:`. For the "Caso citado" card (tagline, cover), take the slug from the end of `url` and use `GET /cases/:slug?locale=` (cached).
- If the answer cites nothing but the search found relevant fragments, `sources` lists those (at most 3), so a card can still be shown.
- **Stopping:** abort the `fetch` (AbortController) when the visitor closes the drawer or leaves. The API stops the generation and stores what was written (`stopReason: "aborted"`); no more events are sent.
- One message at a time per conversation: wait for `done`/`error` before sending the next one.

`stopReason`:

| Value | Meaning |
|---|---|
| `end_turn` | Normal answer |
| `max_tokens` | The answer hit the length cap (rare; `content` is what was written, or a "couldn't finish, rephrase" message) |
| `tool_limit` | The model kept calling tools (4 rounds); it answered with what it had |
| `refusal` | Claude's safety system declined (after the automatic fallback). `content` is a friendly message |
| `pause_turn`, `stop_sequence`, `model_context_window_exceeded` | Not expected; handle like `end_turn` |

`Usage` (also stored on the message, for the cost dashboard):

```json
{ "inputTokens": 6, "outputTokens": 366, "cacheReadInputTokens": 3159, "cacheCreationInputTokens": 3728, "requests": 2 }
```

Totals of the turn: one model request per tool round (`requests`). `inputTokens` are the uncached input tokens; with prompt caching almost all of the prompt is read from or written to the cache.

### 10.3 Example

Request `{ "visitorId": "…", "locale": "es", "message": "¿Tienen experiencia con sistemas para contadores?" }`. Stream from the real smoke test (text shortened):

```text
event: conversation
data: {"conversationId":"cmwvjg9wk0007j0uqwmn1x0rt"}

event: tool
data: {"name":"buscar_casos","status":"started"}

event: tool
data: {"name":"buscar_casos","status":"completed"}

event: delta
data: {"text":"Sí. Hicimos **ContaFlow IA**, una plataforma SaaS para estudios contables en Perú.\n\n- **Qué resuelve:** "}

event: delta
data: {"text":"centraliza documentos fiscales, el calendario de obligaciones y un checklist de cierre por periodo…"}

: keep-alive

event: sources
data: [{"sourceKey":"caso:contaflow-ia#0","title":"ContaFlow IA","url":"/es/casos/contaflow-ia"}]

event: done
data: {"messageId":"cmwvjgb3m000aj0uq4w3u3o9k","stopReason":"end_turn","unanswered":false,"content":"Sí. Hicimos **ContaFlow IA**, …","usage":{"inputTokens":6,"outputTokens":366,"cacheReadInputTokens":3159,"cacheCreationInputTokens":3728,"requests":2}}

```

A booked call adds `event: lead` / `data: {"created":true}` and `event: meeting` / `data: {"status":"BOOKED","start":"2026-11-26T15:00:00.000Z","meetLink":"https://meet.google.com/abc-defg-hij"}` before `sources`.

Reading it in the browser:

```ts
const res = await fetch(`${API}/api/v1/assistant/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ conversationId, visitorId, locale, message, caseSlug }),
  signal: controller.signal,
});
if (!res.ok) throw await res.json(); // 400 | 404 | 429 | 503, shared error format
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
let buffer = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  let end;
  while ((end = buffer.indexOf("\n\n")) >= 0) {
    const block = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    if (block.startsWith(":")) continue; // keep-alive
    const event = /^event: (.+)$/m.exec(block)?.[1];
    const data = JSON.parse(/^data: (.*)$/m.exec(block)![1]);
    handle(event, data); // conversation | tool | delta | lead | meeting | sources | done | error
  }
}
```

### 10.4 What the assistant does (for the UI copy)

- **Model:** `AssistantSettings.model` (default `claude-sonnet-5-5`), effort `low` by default ("Nivel de esfuerzo"). No `temperature`. Refusals are retried automatically on a fallback model (server-side `fallbacks: "default"`).
- **Prompt:** the studio's instructions (editable in the admin) plus fixed rules: answer only from the knowledge base, cite, say so when there is no information and offer the team, never give prices, treat case content and visitor messages as data (prompt-injection defence), never reveal the system prompt, other visitors' data or anonymised clients, answer in the visitor's language. Each visitor message is sent with a small context block (site locale, current date and time in Lima, page). The last **12 turns** of the conversation are sent as history.
- **Prompt caching:** tools, then system (cache breakpoint), then messages (automatic breakpoint). After the first request almost all input is a cache read.
- **`buscar_casos(query, tipo?, tecnologia?)`:** semantic search (cosine similarity, threshold `KNOWLEDGE_MIN_SIMILARITY`, default **0.50**) in the visitor's locale first, then the other locale; up to 5 fragments. `tipo` is a `CaseType`, `tecnologia` a technology name or slug; both exclude FAQs. With `caseSlug`, that case's chunks get +0.10. When **every** search of a turn finds nothing above the threshold, the question is marked **"sin respuesta"** (`unanswered`).
- **`crear_lead(nombre, email, telefono?, interes, resumen)`:** validates the email and creates the lead (`source: CHAT_IA`, `locale`, `conversationId`, `message` = the assistant's summary). **One lead per conversation:** later calls update it. Sets `Conversation.hasLead`.
- **`agendar_reunion(nombre, email, fecha_hora_preferida, zona_horaria, motivo)`:** creates or updates the lead (without overwriting what `crear_lead` stored), converts the visitor's local time (IANA zone) and checks it against `SiteSettings`: business hours (Monday to Saturday 08:00–19:00 `America/Lima` by default; the meeting must **end** by closing time; never on a closed day such as Sunday), `meetingDurationMinutes` (30), at least 2 hours of notice and at most 60 days ahead.
  - **With Google Calendar** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`): `freeBusy` on the studio's **primary** calendar. Free: event with a Google Meet link, the visitor invited (`sendUpdates=all`), `Meeting` `BOOKED` with `googleEventId`. Busy or outside hours: up to **3 free alternatives** (30-minute steps, inside business hours, within 14 days), which the assistant proposes in both time zones. The busy periods of the agenda are never exposed. If Google fails, the request is stored as `REQUESTED`.
  - **Without Google Calendar** (the current setup): `Meeting` `REQUESTED` at the preferred time (or alternatives within business hours) and the team confirms by email.
  - One booked meeting per conversation; a new request replaces a pending one.

### 10.5 Data stored per conversation

`Conversation` (`id`, `visitorId`, `locale`, `caseSlug`, `hasLead`, `unanswered`, `messageCount`, `lastMessageAt`, `ipHash` = HMAC of the IP, never the IP) and its `Message` rows: the visitor message (with the context sent to the model) and the final answer with `sources`, `toolCalls` (name, input, status and a short outcome, no fragment texts), `usage`, `model` (the model that answered; a fallback model after a refusal) and `stopReason`. A failed turn stores an answer with `stopReason: "error"`.

### 10.6 Knowledge base sync

Automatic and **fire-and-forget** (like the revalidation webhook: the admin request never waits for it or fails because of it), on one in-process queue:

| Change | Effect |
|---|---|
| `PATCH /admin/cases/:id`, publish, unpublish, `DELETE` | The case is re-chunked (every locale); unchanged chunks keep their embeddings, removed ones are deleted |
| FAQ `PATCH`, publish, unpublish, `DELETE` | Same for the FAQ |
| `POST /admin/knowledge/reindex` | Everything, plus removal of chunks whose source is no longer eligible. All changed chunks are embedded in as few Voyage requests as possible |

Chunk ids (`sourceKey`): `caso:<slug of that locale>#<n>` and `faq:<faqId>#<n>`. Chunks are about 300–800 tokens: one per short case or FAQ, more for long ones; each repeats a header (title, tagline, type, industry, year, client unless anonymised, technologies). Gallery blocks are not indexed. The seed does **not** index: after `npm run db:seed`, call `POST /admin/knowledge/reindex` once ("Reindexar ahora").

### 10.7 Admin: knowledge base

`GET /admin/knowledge/status` returns **200**:

```json
{
  "state": "SYNCED",
  "label": "Sincronizada",
  "embeddingModel": "voyage-3.5",
  "dimension": 1024,
  "embeddingsConfigured": true,
  "minSimilarity": 0.5,
  "totals": { "sources": 16, "chunks": 16 },
  "counts": [
    { "sourceType": "CASE", "locale": "ES", "sources": 5, "chunks": 5 },
    { "sourceType": "CASE", "locale": "EN", "sources": 5, "chunks": 5 },
    { "sourceType": "FAQ", "locale": "ES", "sources": 3, "chunks": 3 },
    { "sourceType": "FAQ", "locale": "EN", "sources": 3, "chunks": 3 }
  ],
  "pending": { "count": 0, "items": [] },
  "lastIndexedAt": "2026-11-25T03:02:47.801Z",
  "lastRun": {
    "id": "cmwvjg8ve00016kuqkkmf6azy",
    "status": "SUCCEEDED",
    "startedAt": "2026-11-25T03:02:47.019Z",
    "finishedAt": "2026-11-25T03:02:47.808Z",
    "sourcesCount": 16,
    "chunksCount": 16,
    "embeddedCount": 10,
    "removedCount": 0,
    "error": null
  }
}
```

| Field | Notes |
|---|---|
| `state` / `label` | `SYNCED` "Sincronizada" (nothing pending), `PENDING` "Cambios pendientes", `INDEXING` "Indexando…" (a full reindex is running). Show `label` in the dashboard card |
| `pending.items` | Up to 50 `{ sourceType: "CASE" \| "FAQ", sourceId, locale: "ES" \| "EN", title, reason: "new" \| "changed" \| "removed" }`: what a reindex would change. Briefly non-empty right after an edit while the automatic sync runs; permanently if Voyage fails |
| `counts` | Always the four rows. A "source" is one case or FAQ in one locale |
| `embeddingsConfigured` | `false` when the API has no `VOYAGE_API_KEY`: nothing can be indexed or searched |
| `lastRun` | Last full reindex or `null`. `status`: `RUNNING` \| `SUCCEEDED` \| `FAILED` (`error` holds the reason, e.g. a Voyage rate limit). `embeddedCount` = chunks whose embedding was recomputed |

`POST /admin/knowledge/reindex` (no body) returns **202** `{ "runId": "cm…", "status": "RUNNING", "startedAt": "…" }`. Poll `GET /admin/knowledge/status` every 2–3 s until `state` is not `INDEXING`, then read `lastRun`. **409** `"Ya hay una reindexación en curso. Espera a que termine."` while one is running.

### 10.8 Admin: FAQs

Knowledge base FAQs ("Base de conocimiento", "Crear FAQ" from an unanswered question). Bilingual, published **per locale** like cases; only published translations are indexed. There is no public endpoint.

**AdminFaq** (returned by every endpoint below):

```json
{
  "id": "cmwviy6wl0003n4uqokry7xgo",
  "sortOrder": 2,
  "translations": {
    "ES": { "question": "¿Cuánto tiempo toma desarrollar un proyecto?", "answer": "Depende del alcance…", "status": "PUBLISHED", "publishedAt": "2026-11-25T02:48:40.131Z" },
    "EN": null
  },
  "createdAt": "…",
  "updatedAt": "…"
}
```

| Method and path | Body | Response |
|---|---|---|
| `GET /admin/faqs?page&limit&q&status` | — | **200** `{ data: AdminFaq[], meta }`. `q` searches question and answer of both locales (≤ 200); `status` `draft` \| `published` (any locale). Order: `sortOrder`, then creation |
| `GET /admin/faqs/:id` | — | **200**, **404** `"Pregunta frecuente no encontrada"` |
| `POST /admin/faqs` | `{ "translations": { "ES"?: { "question": string, "answer"?: string }, "EN"?: … } }` (at least one locale) | **201**. Every locale starts as `DRAFT`; `answer` defaults to `""`; the FAQ goes last |
| `PATCH /admin/faqs/:id` | `{ "sortOrder"?: int ≥ 0, "translations"?: { "ES"?: { "question"?, "answer"? }, "EN"?: … } }` | **200**. Creates a missing locale (it needs `question`). A published locale cannot be left without question or answer (**422**, `details.missing`) |
| `POST /admin/faqs/:id/publish` | `{ "locale": "ES" \| "EN" }` (lowercase accepted) | **200**, **422** `"No se puede publicar la versión ES. Falta: respuesta"` with `details: { locale, missing: ["question" \| "answer"] }` |
| `POST /admin/faqs/:id/unpublish` | `{ "locale" }` | **200**, **404** when the locale does not exist |
| `DELETE /admin/faqs/:id` | — | **204** (soft delete; its chunks are removed) |

`question`: trimmed, 1–300 characters. `answer`: Markdown, ≤ 10 000, stored as sent. Each mutation schedules the knowledge sync of the FAQ.

### 10.9 Admin: conversations

`GET /admin/conversations?page&limit&filter&q`

| Query | Default | Values |
|---|---|---|
| `page`, `limit` | 1, 20 | Like every admin list (limit ≤ 100) |
| `filter` | `all` | `all` \| `lead` (`hasLead`) \| `unanswered` (at least one question without an answer) |
| `q` | | Case-insensitive search in **every message** and in the lead's name and email (≤ 200) |

**200** (most recent activity first):

```json
{
  "data": [
    {
      "id": "cmwvjg9wk0007j0uqwmn1x0rt",
      "locale": "ES",
      "caseSlug": null,
      "firstQuestion": "¿Tienen experiencia con sistemas para contadores?",
      "messageCount": 4,
      "hasLead": true,
      "unanswered": false,
      "createdAt": "2026-11-25T03:03:12.004Z",
      "lastMessageAt": "2026-11-25T03:04:31.950Z",
      "lead": { "id": "cm…", "name": "Ana Torres", "email": "ana@example.com", "status": "NEW" }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1 }
}
```

`firstQuestion` is truncated to 300 characters; `messageCount` counts visitor and assistant messages; `lead` is `null` when there is none.

`GET /admin/conversations/:id` returns **200** with the transcript:

```json
{
  "id": "cmwvjg9wk0007j0uqwmn1x0rt",
  "visitorId": "smoke-1764039767",
  "locale": "ES",
  "caseSlug": null,
  "hasLead": false,
  "unanswered": false,
  "messageCount": 2,
  "createdAt": "…",
  "lastMessageAt": "…",
  "lead": null,
  "meetings": [],
  "messages": [
    {
      "id": "cm…", "role": "USER", "content": "¿Tienen experiencia con sistemas para contadores?",
      "locale": "ES", "caseSlug": null, "sources": [], "toolCalls": [], "usage": null,
      "model": null, "stopReason": null, "unanswered": false, "createdAt": "…"
    },
    {
      "id": "cm…", "role": "ASSISTANT", "content": "Sí. Hicimos **ContaFlow IA**…",
      "locale": null, "caseSlug": null,
      "sources": [{ "sourceKey": "caso:contaflow-ia#0", "title": "ContaFlow IA", "url": "/es/casos/contaflow-ia" }],
      "toolCalls": [
        {
          "id": "toolu_018LfmxToRpiAsJ3jZp5Q3Zf",
          "name": "buscar_casos",
          "input": { "query": "sistema para estudios contables y contadores" },
          "status": "completed",
          "summary": {
            "results": [{ "sourceKey": "caso:contaflow-ia#0", "similarity": 0.563 }],
            "bestScore": 0.563, "threshold": 0.5, "otherLocale": false
          }
        }
      ],
      "usage": { "inputTokens": 6, "outputTokens": 366, "cacheReadInputTokens": 3159, "cacheCreationInputTokens": 3728, "requests": 2 },
      "model": "claude-sonnet-5-5", "stopReason": "end_turn", "unanswered": false, "createdAt": "…"
    }
  ]
}
```

- `lead`: `{ id, name, email, phone, interest, message, status, createdAt }` or `null`. `meetings`: `{ id, status: "REQUESTED" | "BOOKED" | "CANCELLED", start, end, timezone (the visitor's), meetLink, googleEventId }[]`.
- `unanswered` is set on the **USER** message that found nothing ("sin respuesta"); `sources`, `toolCalls`, `usage`, `model` and `stopReason` on ASSISTANT messages.
- `toolCalls[].summary` by tool: `buscar_casos`: `{ results: [{ sourceKey, similarity }], bestScore, threshold, otherLocale }`; `crear_lead`: `{ leadId, created }`; `agendar_reunion`: `{ leadId, status: "BOOKED" | "REQUESTED" | "UNAVAILABLE" | "ALREADY_BOOKED", meetingId?, start?, reason?, alternatives? }`. A call with `status: "failed"` carries `summary.error`.
- `stopReason` also takes `"aborted"` (the visitor left) and `"error"` (the turn failed; `content` is the error shown to the visitor).
- **404** `"Conversación no encontrada"`.

### 10.10 Admin: assistant settings, test and unanswered questions

`GET /admin/assistant/settings` returns **200**; `PUT /admin/assistant/settings` with **the whole object** (every field below except `updatedAt` is required) returns **200** with the saved settings:

```json
{
  "model": "claude-sonnet-5-5",
  "effort": "low",
  "instructions": "Eres el asistente de miwebprofesional, un estudio de desarrollo de software de Lima (Perú)…",
  "enabledTools": ["buscar_casos", "crear_lead", "agendar_reunion"],
  "maxMessagesPerSession": 20,
  "updatedAt": "2026-11-25T02:48:40.120Z"
}
```

| Field | Rules |
|---|---|
| `model` | `claude-sonnet-5-5` (default, team decision) \| `claude-opus-5-5` \| `claude-haiku-4-5` |
| `effort` | `low` \| `medium` \| `high` ("Nivel de esfuerzo": Bajo / Medio / Alto; replaces "Creatividad"). Ignored by Haiku 4.5. Sonnet 5.5's levels are recalibrated: measure with the evaluation set before raising it |
| `instructions` | Trimmed, 1–8000 characters. The fixed rules (10.4) are always added after them and cannot be edited |
| `enabledTools` | Subset of `buscar_casos`, `crear_lead`, `agendar_reunion` (no repeats; `[]` allowed). Returned in that fixed order |
| `maxMessagesPerSession` | Integer 1–100: visitor messages per conversation |
| `updatedAt` | Read-only (rejected in the PUT) |

**400** for any other value or property (e.g. `temperature`). Changes apply to the next chat message.

`POST /admin/assistant/test` ("Probar pregunta sobre este caso") returns **200** JSON. **No streaming, nothing stored**, and only `buscar_casos` is offered (no leads or meetings):

```jsonc
// Request
{ "question": "¿Qué problema resolvió este proyecto?", "locale": "es", "caseSlug": "contaflow-ia" }
// Response
{
  "answer": "ContaFlow IA centralizó los documentos fiscales…",
  "sources": [{ "sourceKey": "caso:contaflow-ia#0", "title": "ContaFlow IA", "url": "/es/casos/contaflow-ia" }],
  "usage": { "inputTokens": 6, "outputTokens": 180, "cacheReadInputTokens": 2900, "cacheCreationInputTokens": 400, "requests": 2 },
  "model": "claude-sonnet-5-5",
  "stopReason": "end_turn",
  "unanswered": false,
  "toolCalls": [{ "id": "toolu_…", "name": "buscar_casos", "input": { "query": "…" }, "status": "completed", "summary": { "results": [{ "sourceKey": "caso:contaflow-ia#0", "similarity": 0.61 }], "bestScore": 0.71, "threshold": 0.5, "otherLocale": false } }]
}
```

`question` 1–1000, `locale` `es` \| `en`, `caseSlug` optional (slug in that locale). It uses the **saved** settings: save them before testing new instructions. The case must be **published** for its chunks to exist. **503** without `ANTHROPIC_API_KEY`; a Claude failure returns **500** in the shared format. It takes a few seconds: show a spinner.

`GET /admin/assistant/unanswered?days=7` (`days` 1–365, default 7) returns **200**, for the "Crear FAQ" banner and the dashboard:

```json
{
  "days": 7,
  "count": 1,
  "questions": [
    { "messageId": "cm…", "conversationId": "cm…", "question": "¿Hacen apps para relojes inteligentes?", "locale": "ES", "createdAt": "2026-11-25T03:07:20.118Z" }
  ]
}
```

`count` is the total in the period; `questions` holds the latest 20.

### 10.11 Admin: dashboard

`GET /admin/stats/overview?days=30` (`days` 1–365, default 30) returns **200**:

```json
{
  "range": { "days": 7, "from": "2026-11-19", "to": "2026-11-25", "timeZone": "America/Lima" },
  "totals": { "visits": 0, "conversations": 6, "newLeads": 1, "unanswered": 1 },
  "series": [
    { "date": "2026-11-19", "conversations": 0, "leads": 0 },
    { "date": "2026-11-25", "conversations": 6, "leads": 1 }
  ],
  "topQuestions": [{ "question": "¿Tienen experiencia con sistemas para contadores?", "count": 2 }],
  "latestLeads": [
    { "id": "cm…", "name": "Ana Torres", "email": "ana@example.com", "source": "CHAT_IA", "status": "NEW", "interest": "Plataforma SaaS", "createdAt": "…" }
  ]
}
```

- Days are calendar days in the site time zone (`SiteSettings.timezone`), from `today - days + 1` to today; `series` has **one entry per day** (zeros included), oldest first (the example omits the middle days).
- `visits`: sum of `PageView` counts in the period (0 until the front records visits). `conversations`: started in the period. `newLeads`: non-deleted leads created in the period (any source). `unanswered`: visitor questions marked "sin respuesta".
- `topQuestions`: up to 5 first questions of the period's conversations, grouped ignoring case, accents and punctuation. `latestLeads`: the 5 newest leads (any date).

### 10.12 Errors and limits summary

| Limit | Value |
|---|---|
| Chat message | 1–1000 characters |
| Chat rate | 10 messages per minute per IP and per `visitorId` (429 `rate_limit`) |
| Messages per conversation | `maxMessagesPerSession` (default 20, 1–100) visitor messages (429 `session_limit`) |
| History sent to the model | Last 12 turns |
| Tool rounds per answer | 4 |
| Search | 5 fragments, similarity ≥ `KNOWLEDGE_MIN_SIMILARITY` (0.50) |
| Meetings | Business hours of `SiteSettings`, `meetingDurationMinutes`, ≥ 2 h notice, ≤ 60 days ahead, ≤ 3 alternatives |

| Status | Assistant endpoints |
|---|---|
| 202 | `POST /admin/knowledge/reindex` started |
| 400 | Validation |
| 401 / 403 | Admin endpoints without a valid token / with a role other than `ADMIN` or `EDITOR` |
| 404 | Unknown or foreign conversation, unknown FAQ |
| 409 | A reindex is already running |
| 422 | Publishing (or emptying a published) FAQ translation that is incomplete |
| 429 | Chat rate limit or session limit (`details.reason`) |
| 503 | No `ANTHROPIC_API_KEY` (chat and test) |
