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

export async function createUser(
  prisma: PrismaService,
  data: { id: string; name: string; role?: 'ADMIN' | 'EDITOR' },
): Promise<string> {
  await prisma.user.create({
    data: {
      id: data.id,
      email: `${data.id}@miwebprofesional.com`,
      name: data.name,
      role: data.role ?? 'EDITOR',
      passwordHash: 'not-a-real-hash',
    },
  });
  return data.id;
}

export interface BlogTranslationFixture {
  title: string;
  slug: string;
  excerpt?: string | null;
  content?: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  status?: PublicationStatus;
  publishedAt?: Date | null;
}

export async function createBlogPost(
  prisma: PrismaService,
  fixture: {
    authorId?: string | null;
    coverImageUrl?: string | null;
    deleted?: boolean;
    createdAt?: Date;
    /** Technology ids in chip order. */
    technologies?: string[];
    translations: Partial<Record<Locale, BlogTranslationFixture>>;
  },
): Promise<string> {
  const { id } = await prisma.blogPost.create({
    data: {
      authorId: fixture.authorId ?? null,
      coverImageUrl: fixture.coverImageUrl ?? null,
      deletedAt: fixture.deleted ? new Date() : null,
      ...(fixture.createdAt ? { createdAt: fixture.createdAt } : {}),
      technologies: {
        create: (fixture.technologies ?? []).map((technologyId, index) => ({
          technologyId,
          sortOrder: index + 1,
        })),
      },
      translations: {
        create: Object.entries(fixture.translations).map(([locale, t]) => {
          const status = t.status ?? 'PUBLISHED';
          return {
            locale: locale as Locale,
            title: t.title,
            slug: t.slug,
            excerpt:
              t.excerpt === undefined ? `Extracto de ${t.title}` : t.excerpt,
            content: t.content ?? `# ${t.title}\n\nCuerpo del artículo.`,
            seoTitle: t.seoTitle ?? null,
            seoDescription: t.seoDescription ?? null,
            status,
            publishedAt:
              t.publishedAt !== undefined
                ? t.publishedAt
                : status === 'PUBLISHED'
                  ? new Date()
                  : null,
          };
        }),
      },
    },
  });
  return id;
}
