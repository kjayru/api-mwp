import { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { setupApp } from '../../src/setup-app.js';

/** Boots the real AppModule with the same global setup as main.ts. */
export async function createTestApp(
  controllers: Type[] = [],
  configure: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<NestExpressApplication> {
  const moduleFixture = await configure(
    Test.createTestingModule({
      imports: [AppModule],
      controllers,
    }),
  ).compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  setupApp(app);
  await app.init();
  return app;
}

/** Empties every application table of the test database. */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`);
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list.join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/** Clears the in-memory rate limit counters. */
export function resetThrottler(app: INestApplication): void {
  app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
}
