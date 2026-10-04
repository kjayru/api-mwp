---
title: "NestJS 12 + Prisma 7 on ESM: how we start an API"
slug: "nestjs-12-prisma-7-esm-how-we-start-an-api"
excerpt: "The groundwork behind the miwebprofesional API: native ESM with nodenext, Prisma 7 with a driver adapter, zod-validated config, routes protected by default and dependencies without install scripts."
seoTitle: "NestJS 12 + Prisma 7 on ESM: how we start an API"
seoDescription: "ESM with nodenext, prisma.config.ts and the pg adapter, fail-fast zod validation, a global guard with @Public(), one error shape and why we skipped Prisma 8 RC."
technologies: ["nestjs", "prisma", "postgresql"]
publishedAt: "2026-08-28"
---

The first few hours of an API decide how expensive it will be to maintain. When we started the miwebprofesional API at MWP (NestJS 12, Prisma 7 and PostgreSQL with pgvector), we made a handful of decisions that never show up on a screen but save us trouble every day. Here they are, with the actual code.

## ESM from day one

The project is a native ES module: `"type": "module"` in `package.json`, and TypeScript set to `nodenext` resolution:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "ES2023",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "strict": true
  }
}
```

The most visible consequence is that **relative imports carry a `.js` extension**, even though the source file is `.ts`:

```ts
import { AppModule } from './app.module.js';
import { validateEnv } from './config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
```

It looks odd at first, but it makes sense. TypeScript doesn't rewrite import paths when it compiles, and Node in ESM mode wants the exact path of the file it will run, which is the `.js` file in `dist/`. With `nodenext`, the compiler flags a missing extension right away, so the mistake never reaches production.

ESM also lets the entry point use top-level `await`:

```ts
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  setupApp(app);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
```

## Prisma 7: the connection moves out of the schema

In Prisma 7 the database URL no longer belongs in `schema.prisma`. It goes in `prisma.config.ts`, together with the schema path, the migrations folder and the seed command:

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --experimental-strip-types --import ./prisma/ts-resolve-hook.mjs prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

Node runs the seed directly, using its built-in TypeScript type stripping. A tiny resolve hook maps `./file.js` specifiers to `./file.ts`, so scripts don't need `tsx` or any other compiler.

The schema uses the `prisma-client` generator, which requires an output path. We point it inside `src/`, outside `node_modules`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

The generated client isn't committed. It's rebuilt on `postinstall` by `prisma generate`. Keeping it under `src/` means it gets compiled and imported like any other module in the project (`../generated/prisma/client.js`), without the magic of a package that changes inside `node_modules`.

### The `pg` driver adapter

Prisma 7 talks to PostgreSQL through a *driver adapter*. We use `@prisma/adapter-pg`, which sits on top of the `pg` driver:

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    // The connection opens lazily on the first query, so the API can boot
    // (and report itself unhealthy) while the database is down.
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

Note that the URL comes from validated configuration, not from a loose `process.env` read. That brings us to the next point.

## Zod-validated config that fails fast

A typo in an environment variable shouldn't be discovered by the first user. We validate the whole environment with zod at boot, and if anything is wrong the API refuses to start:

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

The function plugs into `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })`. Failing fast is only half the benefit. Values also arrive already coerced (`PORT` is a number, not a string), and the `Env` type lets us write `config.get('PORT', { infer: true })` with autocomplete and correct types. The real schema has cross-field rules as well: if the revalidation webhook URL is set, the shared secret becomes required and must meet a minimum length.

## Secure by default: a global guard and `@Public()`

In many APIs, every protected controller carries its own `@UseGuards(...)`, and forgetting it once leaves an endpoint wide open. We flipped the rule: **everything requires authentication** unless it's explicitly marked public.

```ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

The guard is registered globally through `APP_GUARD`, followed by the roles guard. Order matters here: authenticate first, then check the role.

```ts
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
],
```

The first thing the guard does is check whether the route or its controller is public:

```ts
async canActivate(context: ExecutionContext): Promise<boolean> {
  const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
    IS_PUBLIC_KEY,
    [context.getHandler(), context.getClass()],
  );
  if (isPublic) {
    return true;
  }
  // ...verify the Bearer token and put the user on request.user
}
```

A new endpoint starts out closed. Opening it is a decision you can see in code review, because someone has to type `@Public()`.

## One error shape

The public site and the admin panel both consume the same API, so every error has the same shape, whether it comes from validation, a 404 or an unexpected exception:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Caso no encontrado",
  "path": "/api/v1/cases/nope?locale=es",
  "timestamp": "2026-10-02T22:14:08.380Z"
}
```

A global `@Catch()` filter builds that response. For an `HttpException` it keeps the status and message. Anything else becomes a 500 with a generic message, and the details go to the log only, never to the client. When a client needs structured data, such as the list of fields missing before a publish, the error also carries a `details` field.

## Dependencies: stable versions, no install scripts

We made two dependency decisions on purpose.

**We pinned Prisma 7.10, not 8.** When we started, npm's `latest` tag for Prisma pointed to a release candidate of 8.0. A bare `npm install prisma` would have dropped an RC into a project headed for production. We chose the latest stable release, 7.10.0, and recorded the reason in our technical decision log. We'll look at 8 once it's stable.

**We prefer dependencies without install scripts.** npm 11 adds an `allowScripts` field to `package.json` that lists which packages may run lifecycle scripts like `postinstall`. In the current release the field is advisory (npm prints the packages whose scripts haven't been reviewed), and the docs say a future release will block unapproved scripts. Our list is short and pinned by version:

```json
{
  "allowScripts": {
    "prisma@7.10.0": true,
    "@prisma/engines@7.10.0": true
  }
}
```

To keep it that way, we pick options that need no native builds. Passwords use `scrypt` from `node:crypto` instead of native hashing packages, and the seed relies on Node's built-in TypeScript support instead of `tsx`, which depends on esbuild and its install script. Every script that doesn't run is one less supply-chain attack surface.

## In short

- ESM with `nodenext`: relative imports end in `.js`, and the compiler tells you when one doesn't.
- Prisma 7: the URL lives in `prisma.config.ts`, the client is generated into `src/`, and `@prisma/adapter-pg` handles the connection.
- The environment is validated with zod at boot, and the API won't start if something is missing.
- A global JWT guard plus an explicit `@Public()` means every new endpoint starts out protected.
- Every client sees the same error shape.
- Stable versions (Prisma 7.10, not the 8 RC), and very few dependencies with install scripts, each declared in `allowScripts`.

If you're about to start a NestJS and Prisma API, or want a second pair of eyes on an existing one, let's talk. For further reading, the [Prisma `prisma.config.ts` reference](https://www.prisma.io/docs/orm/reference/prisma-config-reference) and the [NestJS guards docs](https://docs.nestjs.com/guards) are good starting points.
