---
title: "NestJS 12 + Prisma 7 con ESM: cómo arrancamos una API"
slug: "nestjs-12-prisma-7-esm-como-arrancamos-una-api"
excerpt: "Las decisiones con las que arrancamos la API de miwebprofesional: ESM con nodenext, Prisma 7 con driver adapter, entorno validado con zod, rutas protegidas por defecto y dependencias sin scripts de instalación."
seoTitle: "NestJS 12 + Prisma 7 con ESM: cómo arrancamos una API"
seoDescription: "ESM con nodenext, prisma.config.ts y adapter pg, validación de entorno con zod, guard global con @Public(), errores uniformes y por qué no usamos Prisma 8 RC."
technologies: ["nestjs", "prisma", "postgresql"]
publishedAt: "2026-08-28"
---

Las primeras horas de una API definen cuánto va a costar mantenerla. En MWP arrancamos la API de miwebprofesional (NestJS 12, Prisma 7 y PostgreSQL con pgvector) con un puñado de decisiones que no se ven en ninguna pantalla, pero que nos ahorran problemas todos los días. Estas son, con el código real.

## ESM desde el día uno

El proyecto es un módulo ES nativo: `"type": "module"` en `package.json` y TypeScript configurado con resolución `nodenext`:

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

La consecuencia que más se nota es que **los imports relativos llevan extensión `.js`**, aunque el archivo fuente sea `.ts`:

```ts
import { AppModule } from './app.module.js';
import { validateEnv } from './config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
```

Al principio choca, pero tiene lógica: TypeScript no reescribe las rutas al compilar, y Node, en modo ESM, exige la ruta exacta del archivo que va a ejecutar, que es el `.js` de `dist/`. Con `nodenext`, el compilador marca el error en cuanto falta la extensión, así que no llega a producción.

ESM también nos permite usar `await` en el nivel superior del archivo de arranque:

```ts
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  setupApp(app);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
```

## Prisma 7: la conexión sale del schema

En Prisma 7 la URL de la base de datos ya no va en `schema.prisma`. Va en `prisma.config.ts`, junto con las rutas del schema, las migraciones y el comando del seed:

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

El seed lo ejecuta Node directamente gracias a su soporte nativo para quitar los tipos de TypeScript. Un pequeño hook de resolución traduce los `./archivo.js` a `./archivo.ts`, y así no necesitamos `tsx` ni otro compilador para los scripts.

En el schema usamos el generador `prisma-client`, que exige una ruta de salida. Elegimos una dentro de `src/`, fuera de `node_modules`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

El cliente generado no se versiona: se regenera en `postinstall` con `prisma generate`. Tenerlo en `src/` hace que se compile y se importe como cualquier otro módulo del proyecto (`../generated/prisma/client.js`), sin la "magia" de un paquete que cambia dentro de `node_modules`.

### El driver adapter de `pg`

Prisma 7 se conecta a PostgreSQL a través de un *driver adapter*. Nosotros usamos `@prisma/adapter-pg`, que se apoya en el driver `pg`:

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    // La conexión se abre con la primera consulta: la API puede arrancar
    // (y reportarse como no saludable) aunque la base esté caída.
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

La URL llega desde la configuración ya validada, no desde `process.env` suelto, lo que nos lleva al siguiente punto.

## Entorno validado con zod: fallar al arrancar

Una variable de entorno mal escrita no debería descubrirse con el primer usuario. Validamos todo el entorno con zod al arrancar y, si algo falla, la API no levanta:

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

La función se conecta a `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })`. Hay dos ventajas más allá de fallar rápido. Los valores llegan ya convertidos (`PORT` es un número, no un string), y el tipo `Env` permite escribir `config.get('PORT', { infer: true })` con autocompletado y tipos correctos. El esquema real también tiene reglas cruzadas: por ejemplo, si se define la URL del webhook de revalidación, el secreto compartido pasa a ser obligatorio y debe tener una longitud mínima.

## Seguro por defecto: guard global y `@Public()`

En muchas APIs cada controlador protegido lleva su `@UseGuards(...)`, y basta olvidarlo una vez para dejar un endpoint abierto. Nosotros invertimos la regla: **todo exige autenticación** salvo lo que se marque explícitamente como público.

```ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

El guard se registra de forma global con `APP_GUARD`, seguido del guard de roles (el orden importa: primero se autentica y luego se comprueba el rol):

```ts
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
],
```

Y lo primero que hace el guard es mirar si la ruta o el controlador son públicos:

```ts
async canActivate(context: ExecutionContext): Promise<boolean> {
  const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
    IS_PUBLIC_KEY,
    [context.getHandler(), context.getClass()],
  );
  if (isPublic) {
    return true;
  }
  // ...verifica el Bearer token y deja el usuario en request.user
}
```

Un endpoint nuevo nace cerrado. Abrirlo es una decisión visible en la revisión de código: hay que escribir `@Public()`.

## Un solo formato de error

El front y el admin consumen la misma API, así que todos los errores tienen la misma forma, vengan de una validación, de un 404 o de una excepción inesperada:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Caso no encontrado",
  "path": "/api/v1/cases/nope?locale=es",
  "timestamp": "2026-10-02T22:14:08.380Z"
}
```

Un filtro global (`@Catch()`) construye esta respuesta. Para las `HttpException` respeta el código y el mensaje; para cualquier otra cosa responde 500 con un mensaje genérico y registra el detalle solo en el log, sin exponerlo. Cuando el cliente necesita datos estructurados, por ejemplo qué campos faltan para publicar, el error lleva además un campo `details`.

## Dependencias: estables y sin scripts de instalación

Dos decisiones sobre dependencias que tomamos a propósito.

**Fijamos Prisma 7.10 y no la 8.** Cuando arrancamos, el tag `latest` de npm para Prisma apuntaba a una *release candidate* de la versión 8.0. Un `npm install prisma` sin versión nos habría metido una RC en un proyecto que va a producción. Elegimos la última versión estable, 7.10.0, y lo dejamos registrado en nuestras decisiones técnicas, junto con el motivo. La migración a 8 se evaluará cuando sea estable.

**Preferimos dependencias sin scripts de instalación.** npm 11 añade el campo `allowScripts` en `package.json` para declarar qué paquetes pueden ejecutar scripts como `postinstall`. En la versión actual el campo es informativo (npm avisa de los scripts que no se han revisado), y la documentación anuncia que en una versión futura bloqueará los no aprobados. Nuestra lista es corta y está fijada por versión:

```json
{
  "allowScripts": {
    "prisma@7.10.0": true,
    "@prisma/engines@7.10.0": true
  }
}
```

Para mantenerla así, elegimos alternativas sin compilación nativa: contraseñas con `scrypt` de `node:crypto` en lugar de paquetes nativos de hashing, y el seed con el soporte nativo de TypeScript de Node en lugar de `tsx`, que depende de esbuild y de su script de instalación. Cada script que no se ejecuta es una superficie de ataque menos en la cadena de suministro.

## En resumen

- ESM con `nodenext`: los imports relativos llevan `.js` y el compilador avisa si falta.
- Prisma 7: URL en `prisma.config.ts`, cliente generado en `src/` y conexión con `@prisma/adapter-pg`.
- El entorno se valida con zod al arrancar: si falta algo, la API no levanta.
- Guard JWT global con `@Public()` explícito: todo endpoint nuevo nace protegido.
- Un solo formato de error para todos los clientes.
- Versiones estables (Prisma 7.10, no la 8 RC) y pocas dependencias con scripts de instalación, declaradas en `allowScripts`.

Si estás por arrancar una API con NestJS y Prisma, o quieres revisar una existente, conversemos. Para profundizar, la [documentación de Prisma sobre `prisma.config.ts`](https://www.prisma.io/docs/orm/reference/prisma-config-reference) y la de [guards de NestJS](https://docs.nestjs.com/guards) son buenos puntos de partida.
