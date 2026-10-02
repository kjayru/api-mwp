// Environment of the e2e tests. They run against a dedicated database (mwp_test)
// in the same Docker container as development; never against `mwp`.
export const TEST_DATABASE_URL =
  'postgresql://mwp:mwp@localhost:5433/mwp_test?schema=public';

export const e2eEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'e2e-test-secret-e2e-test-secret-0123456789',
  JWT_ACCESS_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_DAYS: '7',
};
