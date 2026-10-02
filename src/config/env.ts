import { z } from 'zod';

const MIN_REVALIDATE_SECRET_LENGTH = 32;

/** `FOO=` in a .env file means "not set". */
function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Comma-separated list of origins allowed by CORS (front-mwp and admin-mwp).
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000,http://localhost:3002')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    // HS256 key for access tokens. Generate one with:
    // node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
    OBSERVE_APP_KEY: z.string().optional(),
    OBSERVE_APP_SECRET: z.string().optional(),
    // Local image storage (POST /admin/uploads), served publicly at /uploads.
    UPLOADS_DIR: z.string().min(1).default('./uploads'),
    // Public base URL of UPLOADS_DIR; uploaded files are returned as <this>/<path>.
    PUBLIC_UPLOADS_URL: z
      .url({ protocol: /^https?$/ })
      .default('http://localhost:3001/uploads')
      .transform((value) => value.replace(/\/+$/, '')),
    // front-mwp on-demand revalidation webhook. Optional: when unset, nothing is sent.
    FRONT_REVALIDATE_URL: z.preprocess(
      emptyToUndefined,
      z.url({ protocol: /^https?$/ }).optional(),
    ),
    // Shared with front-mwp (sent as x-revalidate-secret). Required when the URL is set.
    REVALIDATE_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .superRefine((env, ctx) => {
    if (
      env.FRONT_REVALIDATE_URL &&
      (env.REVALIDATE_SECRET ?? '').length < MIN_REVALIDATE_SECRET_LENGTH
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['REVALIDATE_SECRET'],
        message: `REVALIDATE_SECRET must be at least ${MIN_REVALIDATE_SECRET_LENGTH} characters when FRONT_REVALIDATE_URL is set`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
