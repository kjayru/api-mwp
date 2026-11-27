import { isIP } from 'node:net';
import { z } from 'zod';

const MIN_REVALIDATE_SECRET_LENGTH = 32;
const MIN_PREVIEW_SECRET_LENGTH = 32;
/** Chosen by testing real questions against the seeded content (see README). */
export const DEFAULT_KNOWLEDGE_MIN_SIMILARITY = 0.5;

/** `FOO=` in a .env file means "not set". */
function emptyToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

/** Value of Express's `trust proxy` setting (see parseTrustProxy). */
export type TrustProxy = boolean | number | string[];

/** Names understood by Express (proxy-addr) in a `trust proxy` list. */
const TRUST_PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isTrustProxyEntry(entry: string): boolean {
  if (TRUST_PROXY_NAMES.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * TRUST_PROXY -> Express `trust proxy`: "false" | "true" | a number of hops |
 * a comma-separated list of IPs, CIDR subnets and the names loopback,
 * linklocal and uniquelocal. Returns null when the value is invalid.
 */
export function parseTrustProxy(value: string): TrustProxy | null {
  const text = value.trim().toLowerCase();
  if (text === 'false') return false;
  if (text === 'true') return true;
  if (/^\d+$/.test(text)) return Number(text);
  const entries = text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0 || !entries.every(isTrustProxyEntry)) return null;
  return entries;
}

/** A sender: `Name <email>` or a bare email. */
export interface MailAddress {
  name?: string;
  email: string;
}

/** Parses MAIL_FROM; null when the email part is not valid. */
export function parseMailFrom(value: string): MailAddress | null {
  const text = value.trim();
  const match = /^(.*?)\s*<([^<>]+)>$/.exec(text);
  const email = (match ? match[2] : text).trim();
  if (!z.email().safeParse(email).success) return null;
  const name = match?.[1]
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim();
  return name ? { name, email } : { email };
}

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    // Express `trust proxy`: which proxies may set X-Forwarded-For, so req.ip
    // (every per-IP limit) is the visitor's IP. Default: only a proxy on the
    // same machine (Apache). Use "false" when the API is exposed directly.
    TRUST_PROXY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .default('loopback')
        .transform((value, ctx) => {
          const parsed = parseTrustProxy(value);
          if (parsed === null) {
            ctx.addIssue({
              code: 'custom',
              message:
                'TRUST_PROXY must be "false", "true", a number of hops or a comma-separated list of IPs, subnets, loopback, linklocal or uniquelocal',
            });
            return z.NEVER;
          }
          return parsed;
        }),
    ),
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
    // --- reCAPTCHA v3 of the contact form ---
    // Secret key. Without it POST /leads is not verified. (RECAPTCHA_PUBLIC_KEY
    // belongs to the front and is ignored here.)
    RECAPTCHA_SECRET_KEY: optionalString,
    // Minimum score (0-1) to accept a submission.
    RECAPTCHA_MIN_SCORE: z.preprocess(
      emptyToUndefined,
      z.coerce.number().min(0).max(1).default(0.5),
    ),
    // --- Lead notifications (Phase 5) ---
    // SMTP account that emails SiteSettings.contactEmail on every new lead.
    // All five or none: without them the notification is only logged.
    SMTP_HOST: optionalString,
    SMTP_PORT: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(65535).optional(),
    ),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    // Sender, e.g. "miwebprofesional <no-reply@miwebprofesional.com>".
    SMTP_FROM: optionalString,
    // Implicit TLS. Defaults to true on port 465 (STARTTLS is used otherwise).
    SMTP_SECURE: z.preprocess(
      emptyToUndefined,
      z.enum(['true', 'false']).optional(),
    ),
    // Brevo REST API key (xkeysib-...) with permission to send email. When set
    // it takes precedence over SMTP_* and MAIL_FROM is required.
    BREVO_API_KEY: optionalString,
    // Brevo sender: "Name <email>" or a bare email. The address must be a
    // verified sender or belong to an authenticated domain in Brevo.
    MAIL_FROM: optionalString,
    // Base URL of admin-mwp, for the link in the notification email.
    ADMIN_URL: z.preprocess(
      emptyToUndefined,
      z
        .url({ protocol: /^https?$/ })
        .default('http://localhost:3002')
        .transform((value) => value.replace(/\/+$/, '')),
    ),
    // --- Draft preview (Phase 6) ---
    // Shared with front-mwp (server side only): signs the preview tokens and is
    // sent as x-preview-secret. Without it the preview endpoints answer 503.
    PREVIEW_SECRET: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .min(
          MIN_PREVIEW_SECRET_LENGTH,
          `PREVIEW_SECRET must be at least ${MIN_PREVIEW_SECRET_LENGTH} characters`,
        )
        .optional(),
    ),
    // Public origin of the site, for the preview URL (<FRONT_URL>/api/draft?token=...).
    FRONT_URL: z.preprocess(
      emptyToUndefined,
      z
        .url({ protocol: /^https?$/ })
        .default('http://localhost:3000')
        .transform((value) => value.replace(/\/+$/, '')),
    ),
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
    if (env.BREVO_API_KEY && !env.MAIL_FROM) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_FROM'],
        message: 'MAIL_FROM is required when BREVO_API_KEY is set',
      });
    }
    if (env.MAIL_FROM && !parseMailFrom(env.MAIL_FROM)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_FROM'],
        message:
          'MAIL_FROM must be "Name <email@example.com>" or a valid email address',
      });
    }
    const smtp = [
      env.SMTP_HOST,
      env.SMTP_PORT,
      env.SMTP_USER,
      env.SMTP_PASS,
      env.SMTP_FROM,
    ].filter((value) => value !== undefined).length;
    if (smtp !== 0 && smtp !== 5) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message:
          'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM together (or none of them)',
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
