import { z } from 'zod';

const MIN_REVALIDATE_SECRET_LENGTH = 32;
/** Chosen by testing real questions against the seeded content (see README). */
export const DEFAULT_KNOWLEDGE_MIN_SIMILARITY = 0.5;

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
    // --- AI assistant (Phase 4) ---
    // Claude API key. Optional so the API boots without it; the chat then
    // answers 503 (see AssistantService).
    ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    // Voyage AI key for the knowledge base embeddings. Without it indexing and
    // search fail (logged; buscar_casos returns an error to the model).
    VOYAGE_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    // Multilingual Voyage model. It must produce 1024-dimension vectors (the
    // knowledge_chunks.embedding column): voyage-3.5, voyage-3.5-lite and the
    // voyage-4 family do by default. Changing it requires a full reindex.
    VOYAGE_MODEL: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default('voyage-3.5'),
    ),
    // Minimum cosine similarity (0-1) for a chunk to count as relevant. Below
    // it buscar_casos returns nothing and the question is marked "sin respuesta".
    KNOWLEDGE_MIN_SIMILARITY: z.preprocess(
      emptyToUndefined,
      z.coerce.number().min(0).max(1).default(DEFAULT_KNOWLEDGE_MIN_SIMILARITY),
    ),
    // Google Calendar (OAuth 2.0 with offline access, primary calendar of the
    // studio account). All three or none: without them agendar_reunion stores
    // a REQUESTED meeting and the team confirms it by email.
    GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
    GOOGLE_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
    GOOGLE_REFRESH_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
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
    const google = [
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REFRESH_TOKEN,
    ].filter(Boolean).length;
    if (google !== 0 && google !== 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_REFRESH_TOKEN'],
        message:
          'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN together (or none of them)',
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
