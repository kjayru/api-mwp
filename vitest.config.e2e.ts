import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The database is mocked in e2e tests; this only satisfies env validation.
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5433/test',
    },
  },
});
