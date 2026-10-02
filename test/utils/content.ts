// Direct-to-database fixtures for the content e2e tests.
import type { Prisma } from '../../src/generated/prisma/client.js';
import type {
  CaseType,
  Locale,
  PublicationStatus,
} from '../../src/generated/prisma/enums.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

export interface TranslationFixture {
  title: string;
  slug: string;
  status?: PublicationStatus;
  summary?: string;
  industry?: string | null;
  tagline?: string | null;
  blocks?: unknown[];
}

export interface CaseFixture {
  type?: CaseType;
  sortOrder?: number;
  client?: string | null;
  anonymizeClient?: boolean;
  deleted?: boolean;
  /** Technology ids in chip order. */
  technologies?: string[];
  images?: { id: string; url: string; alt?: Record<string, string> }[];
  translations: Partial<Record<Locale, TranslationFixture>>;
}

export async function createTechnology(
  prisma: PrismaService,
  data: {
    name: string;
    slug: string;
    sortOrder?: number;
    isFeatured?: boolean;
    deleted?: boolean;
    descriptions?: Partial<Record<Locale, string>>;
  },
): Promise<string> {
  const { id } = await prisma.technology.create({
    data: {
      name: data.name,
      slug: data.slug,
      sortOrder: data.sortOrder ?? 0,
      isFeatured: data.isFeatured ?? false,
      deletedAt: data.deleted ? new Date() : null,
      translations: {
        create: Object.entries(data.descriptions ?? {}).map(
          ([locale, description]) => ({
            locale: locale as Locale,
            description,
          }),
        ),
      },
    },
  });
  return id;
}

export async function createCase(
  prisma: PrismaService,
  fixture: CaseFixture,
): Promise<string> {
  const { id } = await prisma.case.create({
    data: {
      type: fixture.type ?? 'SAAS',
      sortOrder: fixture.sortOrder ?? 0,
      client: fixture.client ?? null,
      anonymizeClient: fixture.anonymizeClient ?? false,
      deletedAt: fixture.deleted ? new Date() : null,
      images: {
        create: (fixture.images ?? []).map((image, index) => ({
          id: image.id,
          url: image.url,
          alt: image.alt ?? {},
          sortOrder: index + 1,
        })),
      },
      technologies: {
        create: (fixture.technologies ?? []).map((technologyId, index) => ({
          technologyId,
          sortOrder: index + 1,
        })),
      },
      translations: {
        create: Object.entries(fixture.translations).map(([locale, t]) => ({
          locale: locale as Locale,
          title: t.title,
          slug: t.slug,
          tagline: t.tagline ?? null,
          summary: t.summary ?? `Resumen de ${t.title}`,
          industry: t.industry ?? null,
          blocks: (t.blocks ?? [
            { type: 'text', title: 'El reto', body: 'Texto' },
          ]) as Prisma.InputJsonValue,
          status: t.status ?? 'PUBLISHED',
          publishedAt:
            (t.status ?? 'PUBLISHED') === 'PUBLISHED' ? new Date() : null,
        })),
      },
    },
  });
  return id;
}

export async function createService(
  prisma: PrismaService,
  fixture: {
    sortOrder?: number;
    deleted?: boolean;
    technologies?: string[];
    translations: Partial<
      Record<
        Locale,
        {
          title: string;
          slug: string;
          description?: string;
          status?: PublicationStatus;
        }
      >
    >;
  },
): Promise<string> {
  const { id } = await prisma.service.create({
    data: {
      sortOrder: fixture.sortOrder ?? 0,
      deletedAt: fixture.deleted ? new Date() : null,
      technologies: {
        create: (fixture.technologies ?? []).map((technologyId, index) => ({
          technologyId,
          sortOrder: index + 1,
        })),
      },
      translations: {
        create: Object.entries(fixture.translations).map(([locale, t]) => ({
          locale: locale as Locale,
          title: t.title,
          slug: t.slug,
          description: t.description ?? `Descripción de ${t.title}`,
          status: t.status ?? 'PUBLISHED',
        })),
      },
    },
  });
  return id;
}
