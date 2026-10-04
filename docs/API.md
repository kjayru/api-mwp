# api-mwp: content API contract (Phases 3 and 3.6)

This is the contract for **front-mwp** (public site) and **admin-mwp** (admin panel): cases, technologies, services, stats, the blog (Phase 3.6), image uploads and the front revalidation webhook. Auth (`/auth/*`) is documented in the README.

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
- `details` appears only on **422** (publication) errors. It is machine-readable, so the admin can highlight the fields:

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
