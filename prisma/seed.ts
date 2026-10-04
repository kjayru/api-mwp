// Idempotent development seed: run it as many times as you like (npm run db:seed).
// - Admin user: created from SEED_ADMIN_*; on later runs only its role (ADMIN) and
//   isActive are enforced. The password is never overwritten.
// - SiteSettings: created once; later runs keep the values edited in the admin.
// - Technologies, services, cases and blog posts: create-only (natural keys:
//   technology slug or name, ES translation slug). Existing rows, edited or
//   soft-deleted from the admin, are never touched, so the seed is safe to re-run
//   on QA.
// - Blog posts come from Markdown files in prisma/seed-content/blog/ (format in
//   prisma/blog-content.ts). They are validated before anything is written.
//
// Runs with Node's native type stripping (no tsx): see prisma/ts-resolve-hook.mjs.
import '../src/config/load-env.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Locale, Prisma } from '../src/generated/prisma/client.js';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/modules/auth/scrypt.js';
import { loadBlogContent, seedBlogPosts } from './blog-content.js';
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
const BLOG_CONTENT_DIR = fileURLToPath(
  new URL('./seed-content/blog/', import.meta.url),
);

/**
 * Reads and validates the blog posts before anything is written. Known
 * technologies: the ones in seed-data.ts plus any already in the database.
 */
async function loadBlogPosts(prisma: PrismaClient) {
  const existing = await prisma.technology.findMany({ select: { slug: true } });
  const known = new Set([
    ...technologies.map((t) => t.slug),
    ...existing.map((t) => t.slug),
  ]);
  return loadBlogContent(BLOG_CONTENT_DIR, known);
}

/** Every technology by slug; seed-data slugs map to the row seedTechnologies matched. */
async function technologyIdsBySlug(
  prisma: PrismaClient,
  seeded: Map<string, string>,
): Promise<Map<string, string>> {
  const rows = await prisma.technology.findMany({
    select: { id: true, slug: true },
  });
  const ids = new Map(rows.map((row): [string, string] => [row.slug, row.id]));
  for (const [slug, id] of seeded) ids.set(slug, id);
  return ids;
}

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

/** Returns the admin's id (author of the seeded blog posts). */
async function seedAdmin(prisma: PrismaClient): Promise<string> {
  const { email, name, password } = readAdminEnv();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { role: 'ADMIN', isActive: true },
    });
    console.log(`  admin user ${email}: already exists (password unchanged)`);
    return existing.id;
  }
  const { id } = await prisma.user.create({
    data: {
      email,
      name,
      role: 'ADMIN',
      passwordHash: await hashPassword(password),
    },
    select: { id: true },
  });
  console.log(`  admin user ${email}: created`);
  return id;
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
  let created = 0;
  // Fresh database: the seed order. Otherwise new rows go after the existing ones.
  const { _max } = await prisma.technology.aggregate({
    _max: { sortOrder: true },
  });
  let lastOrder = _max.sortOrder;
  for (const [index, tech] of technologies.entries()) {
    // Create-only: an existing row (even soft-deleted) is managed from the admin.
    // Names are unique too, so a technology the admin created with another slug
    // (e.g. "Three.js" as three-js) is reused instead of failing.
    const existing = await prisma.technology.findFirst({
      where: {
        OR: [
          { slug: tech.slug },
          { name: { equals: tech.name, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const row =
      existing ??
      (await prisma.technology.create({
        data: {
          ...tech,
          sortOrder: lastOrder === null ? index + 1 : ++lastOrder,
        },
        select: { id: true },
      }));
    if (!existing) created++;
    ids.set(tech.slug, row.id);
  }
  console.log(
    `  technologies: ${created} created, ${technologies.length - created} kept`,
  );
  return ids;
}

function technologyIds(slugs: string[], ids: Map<string, string>): string[] {
  return slugs.map((slug) => {
    const id = ids.get(slug);
    if (!id) throw new Error(`Unknown technology slug in seed data: ${slug}`);
    return id;
  });
}

/** Create-only: returns false when the service already exists (even soft-deleted). */
async function seedService(
  prisma: PrismaClient,
  service: ServiceSeed,
  sortOrder: number,
  techIds: Map<string, string>,
): Promise<boolean> {
  const existing = await prisma.serviceTranslation.findUnique({
    where: {
      locale_slug: { locale: 'ES', slug: service.translations.ES.slug },
    },
    select: { serviceId: true },
  });
  if (existing) return false;
  const linked = technologyIds(service.technologies, techIds);

  await prisma.$transaction(async (tx) => {
    const { id } = await tx.service.create({ data: { sortOrder } });

    for (const locale of LOCALES) {
      await tx.serviceTranslation.create({
        data: {
          ...service.translations[locale],
          serviceId: id,
          locale,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
    }

    await tx.serviceTechnology.createMany({
      data: linked.map((technologyId, i) => ({
        serviceId: id,
        technologyId,
        sortOrder: i + 1,
      })),
    });
  });
  return true;
}

/** Create-only: returns false when the case already exists (even soft-deleted). */
async function seedCase(
  prisma: PrismaClient,
  item: CaseSeed,
  sortOrder: number,
  techIds: Map<string, string>,
): Promise<boolean> {
  const existing = await prisma.caseTranslation.findUnique({
    where: { locale_slug: { locale: 'ES', slug: item.translations.ES.slug } },
    select: { caseId: true },
  });
  if (existing) return false;
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
    const { id } = await tx.case.create({ data: caseData });

    for (const locale of LOCALES) {
      const { blocks, ...t } = item.translations[locale];
      await tx.caseTranslation.create({
        data: {
          ...t,
          blocks: json(blocks),
          status: 'PUBLISHED',
          publishedAt: new Date(),
          caseId: id,
          locale,
        },
      });
    }

    await tx.caseTechnology.createMany({
      data: linked.map((technologyId, i) => ({
        caseId: id,
        technologyId,
        sortOrder: i + 1,
      })),
    });
  });
  return true;
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
    const blog = await loadBlogPosts(prisma);
    const adminId = await seedAdmin(prisma);
    await seedSiteSettings(prisma);
    const techIds = await seedTechnologies(prisma);
    let created = 0;
    for (const [index, service] of services.entries()) {
      if (await seedService(prisma, service, index + 1, techIds)) created++;
    }
    console.log(
      `  services: ${created} created, ${services.length - created} kept`,
    );
    created = 0;
    for (const [index, item] of cases.entries()) {
      if (await seedCase(prisma, item, index + 1, techIds)) created++;
    }
    console.log(`  cases: ${created} created, ${cases.length - created} kept`);
    if (blog && blog.ignored.length > 0) {
      console.log(`  blog posts: ignored files: ${blog.ignored.join(', ')}`);
    }
    if (!blog || blog.posts.length === 0) {
      console.log(
        `  blog posts: skipped (no <key>.es.md / <key>.en.md pairs in ${BLOG_CONTENT_DIR})`,
      );
    } else {
      const result = await seedBlogPosts(
        prisma,
        blog.posts,
        adminId,
        await technologyIdsBySlug(prisma, techIds),
      );
      console.log(
        `  blog posts: ${result.created} created, ${result.kept} kept`,
      );
    }
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
