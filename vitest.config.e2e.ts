import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { e2eEnv } from './test/e2e-env.js';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Creates mwp_test and applies the migrations (prisma migrate deploy).
    globalSetup: ['./test/global-setup.ts'],
    // The suites share one database and truncate it between tests.
    fileParallelism: false,
    env: e2eEnv,
  },
});
