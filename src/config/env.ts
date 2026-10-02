import { z } from 'zod';

const envSchema = z.object({
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
  OBSERVE_APP_KEY: z.string().optional(),
  OBSERVE_APP_SECRET: z.string().optional(),
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
