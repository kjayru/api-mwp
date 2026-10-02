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
};
