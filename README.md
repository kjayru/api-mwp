# api-mwp

API de **miwebprofesional** (NestJS 12, ESM, Prisma 7, PostgreSQL + pgvector). La consumen `front-mwp` (sitio público) y `admin-mwp` (panel). Plan de desarrollo: `c:\proyectos-react\front-mwp\docs\PLAN.md`.

## Requisitos

- Node.js 24
- Docker Desktop (base de datos local)

## Puesta en marcha

```bash
npm install          # también genera el cliente de Prisma (postinstall)
cp .env.example .env # en Windows: copy .env.example .env
npm run db:up        # PostgreSQL 17 + pgvector en localhost:5433
npm run db:deploy    # aplica las migraciones
npm run start:dev    # http://localhost:3001/api/v1
```

Comprobación: `GET http://localhost:3001/api/v1/health` devuelve `{"status":"ok","database":"up","pgvector":true,...}`. Si la base de datos no responde, devuelve `503` con `"database":"down"`.

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
| `test` / `test:e2e` / `test:cov` | Tests unitarios, e2e (base de datos simulada) y cobertura |
| `lint` / `format` | oxlint y Prettier |
| `db:up` / `db:down` | Levanta o detiene la base de datos en Docker |
| `db:migrate` | Crea y aplica una migración en desarrollo (`prisma migrate dev`) |
| `db:deploy` | Aplica las migraciones pendientes (`prisma migrate deploy`) |
| `db:studio` | Prisma Studio |
| `prisma:generate` | Regenera el cliente en `src/generated/prisma` (no se versiona) |

## Convenciones

- Rutas bajo `/api/v1/...`; los errores siguen el formato `{ statusCode, error, message, path, timestamp }`.
- Las variables de entorno se validan al arrancar (`src/config/env.ts`); la API no inicia si falta alguna obligatoria.
- La telemetría de NestJS Observe solo se activa si se definen `OBSERVE_APP_KEY` y `OBSERVE_APP_SECRET`.
- Proyecto ESM: los imports relativos llevan extensión `.js`.
