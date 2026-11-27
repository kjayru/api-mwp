import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Environment of the e2e tests. They run against a dedicated database (mwp_test)
// in the same Docker container as development; never against `mwp`.
export const TEST_DATABASE_URL =
  'postgresql://mwp:mwp@localhost:5433/mwp_test?schema=public';

/** Uploads go to a throwaway directory, never to the development ./uploads. */
export const TEST_UPLOADS_DIR = join(tmpdir(), 'mwp-e2e-uploads');
export const TEST_PUBLIC_UPLOADS_URL = 'http://localhost:3001/uploads';

export const e2eEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'e2e-test-secret-e2e-test-secret-0123456789',
  JWT_ACCESS_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_DAYS: '7',
  UPLOADS_DIR: TEST_UPLOADS_DIR,
  PUBLIC_UPLOADS_URL: TEST_PUBLIC_UPLOADS_URL,
  // Webhook off by default; revalidation.e2e-spec.ts points it at a local server.
  FRONT_REVALIDATE_URL: '',
  REVALIDATE_SECRET: '',
  // The assistant never calls real APIs in e2e: assistant.e2e-spec.ts injects
  // fake Claude and Voyage providers through Nest DI.
  ANTHROPIC_API_KEY: '',
  VOYAGE_API_KEY: '',
  VOYAGE_MODEL: 'fake-embeddings',
  // Suited to the bag-of-words fake embeddings (test/utils/fake-embeddings.ts).
  KNOWLEDGE_MIN_SIMILARITY: '0.15',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  GOOGLE_REFRESH_TOKEN: '',
  // Supertest connects from 127.0.0.1, so X-Forwarded-For simulates visitor IPs.
  TRUST_PROXY: 'loopback',
  // Never real email: phase5.e2e-spec.ts injects a fake transport.
  BREVO_API_KEY: '',
  MAIL_FROM: '',
  SMTP_HOST: '',
  SMTP_PORT: '',
  SMTP_USER: '',
  SMTP_PASS: '',
  SMTP_FROM: '',
  SMTP_SECURE: '',
  // reCAPTCHA off; recaptcha.e2e-spec.ts injects a fake RecaptchaService.
  RECAPTCHA_SECRET_KEY: '',
  ADMIN_URL: 'http://localhost:3002',
  // Fake values; preview.e2e-spec.ts also boots an app without the secret.
  PREVIEW_SECRET: 'e2e-preview-secret-e2e-preview-secret-01',
  FRONT_URL: 'https://front.example.test',
};
