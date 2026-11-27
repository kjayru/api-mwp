import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/modules/**/*.service.ts', 'src/common/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/dto/**',
        '**/entities/**',
        '**/*.module.ts',
        'src/generated/**',
      ],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
