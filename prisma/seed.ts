// Idempotent development seed: run it as many times as you like (npm run db:seed).
// - Admin user: created from SEED_ADMIN_*; on later runs only its role (ADMIN) and
//   isActive are enforced. The password is never overwritten.
// - SiteSettings: created once; later runs keep the values edited in the admin.
// - Technologies, services and cases: upserted to the seed content (natural keys:
//   technology slug, ES translation slug).
//
// Runs with Node's native type stripping (no tsx): see prisma/ts-resolve-hook.mjs.
import '../src/config/load-env.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Locale, Prisma } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/modules/auth/scrypt.js';
import {
  type CaseSeed,
  cases,
  type ServiceSeed,
  services,
  siteSettings,
  technologies,
} from './seed-data.js';

const LOCALES: Locale[] = ['ES', 'EN'];
const MIN_PASSWORD_LENGTH = 8;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function readAdminEnv() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@miwebprofesional.com')
    .trim()
    .toLowerCase();
  const name = (process.env.SEED_ADMIN_NAME || 'Wile').trim();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_ADMIN_PASSWORD is required (at least ${MIN_PASSWORD_LENGTH} characters). ` +
        'Set it in .env or in the environment before running the seed.',
    );
  }
  return { email, name, password };
}

async function seedAdmin(prisma: PrismaClient) {
  const { email, name, password } = readAdminEnv();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { role: 'ADMIN', isActive: true },
    });
    console.log(`  admin user ${email}: already exists (password unchanged)`);
    return;
  }
  await prisma.user.create({
    data: {
      email,
      name,
      role: 'ADMIN',
      passwordHash: await hashPassword(password),
    },
  });
  console.log(`  admin user ${email}: created`);
}

async function seedSiteSettings(prisma: PrismaClient) {
  await prisma.siteSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      ...siteSettings,
      socialLinks: json(siteSettings.socialLinks),
      businessHours: json(siteSettings.businessHours),
    },
    update: {},
  });
  console.log('  site settings: ok');
}

async function seedTechnologies(
  prisma: PrismaClient,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [index, tech] of technologies.entries()) {
    const data = { ...tech, sortOrder: index + 1, deletedAt: null };
    const row = await prisma.technology.upsert({
      where: { slug: tech.slug },
      create: data,
      update: data,
      select: { id: true },
    });
    ids.set(tech.slug, row.id);
  }
  console.log(`  technologies: ${technologies.length}`);
  return ids;
}

function technologyIds(slugs: string[], ids: Map<string, string>): string[] {
  return slugs.map((slug) => {
    const id = ids.get(slug);
    if (!id) throw new Error(`Unknown technology slug in seed data: ${slug}`);
    return id;
  });
}

async function seedService(
  prisma: PrismaClient,
  service: ServiceSeed,
  sortOrder: number,
  techIds: Map<string, string>,
) {
  const existing = await prisma.serviceTranslation.findUnique({
    where: {
      locale_slug: { locale: 'ES', slug: service.translations.ES.slug },
    },
    select: { serviceId: true },
  });
  const linked = technologyIds(service.technologies, techIds);

  await prisma.$transaction(async (tx) => {
    const { id } = existing
      ? await tx.service.update({
          where: { id: existing.serviceId },
          data: { sortOrder, deletedAt: null },
        })
      : await tx.service.create({ data: { sortOrder } });

    for (const locale of LOCALES) {
      const t = service.translations[locale];
      await tx.serviceTranslation.upsert({
        where: { serviceId_locale: { serviceId: id, locale } },
        create: {
          ...t,
          serviceId: id,
          locale,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
        update: { ...t, status: 'PUBLISHED' },
      });
    }

    await tx.serviceTechnology.deleteMany({ where: { serviceId: id } });
    await tx.serviceTechnology.createMany({
      data: linked.map((technologyId, i) => ({
        serviceId: id,
        technologyId,
        sortOrder: i + 1,
      })),
    });
  });
}

async function seedCase(
  prisma: PrismaClient,
  item: CaseSeed,
  sortOrder: number,
  techIds: Map<string, string>,
) {
  const existing = await prisma.caseTranslation.findUnique({
    where: { locale_slug: { locale: 'ES', slug: item.translations.ES.slug } },
    select: { caseId: true },
  });
  const linked = technologyIds(item.technologies, techIds);
  const caseData = {
    type: item.type,
    client: item.client,
    anonymizeClient: item.anonymizeClient,
    year: item.year,
    includeInKnowledgeBase: true,
    sortOrder,
  };

  await prisma.$transaction(async (tx) => {
    const { id } = existing
      ? await tx.case.update({
          where: { id: existing.caseId },
          data: { ...caseData, deletedAt: null },
        })
      : await tx.case.create({ data: caseData });

    for (const locale of LOCALES) {
      const { blocks, ...t } = item.translations[locale];
      const data = { ...t, blocks: json(blocks), status: 'PUBLISHED' as const };
      await tx.caseTranslation.upsert({
        where: { caseId_locale: { caseId: id, locale } },
        create: { ...data, caseId: id, locale, publishedAt: new Date() },
        update: data,
      });
    }

    await tx.caseTechnology.deleteMany({ where: { caseId: id } });
    await tx.caseTechnology.createMany({
      data: linked.map((technologyId, i) => ({
        caseId: id,
        technologyId,
        sortOrder: i + 1,
      })),
    });
  });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set.');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    console.log('Seeding database...');
    await seedAdmin(prisma);
    await seedSiteSettings(prisma);
    const techIds = await seedTechnologies(prisma);
    for (const [index, service] of services.entries()) {
      await seedService(prisma, service, index + 1, techIds);
    }
    console.log(`  services: ${services.length}`);
    for (const [index, item] of cases.entries()) {
      await seedCase(prisma, item, index + 1, techIds);
    }
    console.log(`  cases: ${cases.length}`);
    console.log('Seed finished.');
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  console.error(
    `Seed failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
