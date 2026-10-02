import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `prisma db seed` (npm run db:seed). Node runs the TypeScript directly with
    // native type stripping; the hook maps NodeNext `.js` specifiers to `.ts`.
    seed: 'node --import ./prisma/ts-resolve-hook.mjs prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
