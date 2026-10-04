// Blog posts of the seed, read from Markdown files (prisma/seed-content/blog/).
//
// Format: one pair of files per post, `<key>.es.md` and `<key>.en.md`, where
// `key` is the ES slug. Each file starts with a frontmatter block between two
// `---` lines in which every line is `key: <JSON value>` (parsed with JSON.parse,
// no YAML), followed by the Markdown body:
//
//   ---
//   title: "Lo que cambió en Next.js 16"
//   slug: "lo-que-cambio-en-nextjs-16"
//   excerpt: "..."
//   seoTitle: "..."                (optional)
//   seoDescription: "..."          (<= 160 characters)
//   technologies: ["nextjs", "react"]
//   publishedAt: "2026-09-12"
//   ---
//   Markdown body...
//
// `technologies` and `publishedAt` are required in the ES file; the EN file may
// repeat them, but then they must match (the ES values are used).
//
// Runs under Node's native type stripping (see ts-resolve-hook.mjs): no enums,
// no parameter properties, type-only imports marked with `import type`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../src/common/slug.js';
import {
  BLOG_CONTENT_MAX,
  BLOG_EXCERPT_MAX,
  BLOG_MAX_TECHNOLOGIES,
  BLOG_SEO_DESCRIPTION_MAX,
  BLOG_SEO_TITLE_MAX,
  BLOG_TITLE_MAX,
} from '../src/modules/blog/blog-limits.js';

type SeedLocale = 'ES' | 'EN';

export interface BlogTranslationSeed {
  title: string;
  slug: string;
  excerpt: string;
  /** Markdown body. */
  content: string;
  seoTitle: string | null;
  seoDescription: string;
}

export interface BlogPostSeed {
  /** ES slug (file name without `.es.md`). */
  key: string;
  /** Technology slugs, in chip order (from the ES file). */
  technologies: string[];
  /** From the ES file. */
  publishedAt: Date;
  translations: Record<SeedLocale, BlogTranslationSeed>;
}

export interface LoadedBlogContent {
  posts: BlogPostSeed[];
  /** Files in the directory that are not `<key>.es.md` / `<key>.en.md`. */
  ignored: string[];
}

/** Invalid seed content; the message names every offending file. */
export class BlogContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlogContentError';
  }
}

export const FRONTMATTER_KEYS = [
  'title',
  'slug',
  'excerpt',
  'seoTitle',
  'seoDescription',
  'technologies',
  'publishedAt',
] as const;

const KEY_LINE = /^([A-Za-z][A-Za-z0-9]*):[ \t]*(.*)$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const POST_FILE = /^(.+)\.(es|en)\.md$/;

/**
 * Splits a seed file into its frontmatter (JSON values by key) and body.
 * Throws BlogContentError (prefixed with `file`) on any syntax problem.
 */
export function parseFrontmatter(
  text: string,
  file: string,
): { data: Record<string, unknown>; body: string } {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trimEnd() !== '---') {
    throw new BlogContentError(
      `${file}: must start with a frontmatter block ("---" on the first line)`,
    );
  }
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  if (end === -1) {
    throw new BlogContentError(
      `${file}: the frontmatter block is not closed (missing the second "---" line)`,
    );
  }

  const data: Record<string, unknown> = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const match = KEY_LINE.exec(line);
    if (!match) {
      throw new BlogContentError(
        `${file}, line ${i + 1}: expected \`key: <JSON value>\`, got ${JSON.stringify(line)}`,
      );
    }
    const [, key, raw] = match;
    if (!(FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      throw new BlogContentError(
        `${file}, line ${i + 1}: unknown key "${key}" (allowed: ${FRONTMATTER_KEYS.join(', ')})`,
      );
    }
    if (Object.hasOwn(data, key)) {
      throw new BlogContentError(
        `${file}, line ${i + 1}: duplicated key "${key}"`,
      );
    }
    try {
      data[key] = JSON.parse(raw);
    } catch (error) {
      throw new BlogContentError(
        `${file}, line ${i + 1}: the value of "${key}" is not valid JSON (${
          error instanceof Error ? error.message : String(error)
        }). Strings need double quotes.`,
      );
    }
  }

  const body = lines
    .slice(end + 1)
    .join('\n')
    .replace(/^\s*\n/, '')
    .trimEnd();
  return { data, body };
}

/** Result of validating one file. */
interface ParsedTranslation {
  translation: BlogTranslationSeed;
  technologies?: string[];
  publishedAt?: Date;
}

/** Parses `YYYY-MM-DD` (UTC midnight) or a full ISO 8601 date-time; null if invalid. */
export function parsePublishedAt(value: string): Date | null {
  if (DATE_ONLY.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    // Rejects impossible days such as 2026-02-30 (they roll over).
    return !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
      ? date
      : null;
  }
  if (DATE_TIME.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/**
 * Validates one file's frontmatter and body. `requireShared`: technologies and
 * publishedAt are required (the ES file). Returns the problems found (each
 * prefixed with `file`) instead of throwing, so every error is reported at once.
 */
export function validateBlogFile(
  data: Record<string, unknown>,
  body: string,
  file: string,
  options: { requireShared: boolean; knownTechnologies: ReadonlySet<string> },
): { result: ParsedTranslation | null; errors: string[] } {
  const errors: string[] = [];
  const problem = (message: string) => errors.push(`${file}: ${message}`);

  const text = (key: string, max: number, required: boolean): string | null => {
    const value = data[key];
    if (value === undefined || value === null) {
      if (required) problem(`"${key}" is required`);
      return null;
    }
    if (typeof value !== 'string') {
      problem(`"${key}" must be a string`);
      return null;
    }
    const trimmed = value.trim();
    if (trimmed === '') {
      if (required) problem(`"${key}" must not be empty`);
      return null;
    }
    if (trimmed.length > max) {
      problem(`"${key}" has ${trimmed.length} characters (max ${max})`);
    }
    return trimmed;
  };

  const title = text('title', BLOG_TITLE_MAX, true);
  const slug = text('slug', SLUG_MAX_LENGTH, true);
  if (slug !== null && !SLUG_PATTERN.test(slug)) {
    problem(
      `"slug" ${JSON.stringify(slug)} must be lowercase letters, digits and single hyphens (e.g. "mi-articulo-2")`,
    );
  }
  const excerpt = text('excerpt', BLOG_EXCERPT_MAX, true);
  const seoTitle = text('seoTitle', BLOG_SEO_TITLE_MAX, false);
  const seoDescription = text('seoDescription', BLOG_SEO_DESCRIPTION_MAX, true);

  if (body.trim() === '') {
    problem('the Markdown body is empty');
  } else if (body.length > BLOG_CONTENT_MAX) {
    problem(`the body has ${body.length} characters (max ${BLOG_CONTENT_MAX})`);
  }

  let technologies: string[] | undefined;
  const rawTechnologies = data.technologies;
  if (rawTechnologies === undefined) {
    if (options.requireShared) problem('"technologies" is required');
  } else if (
    !Array.isArray(rawTechnologies) ||
    !rawTechnologies.every((item) => typeof item === 'string')
  ) {
    problem('"technologies" must be an array of technology slugs');
  } else {
    technologies = rawTechnologies as string[];
    const repeated = technologies.filter(
      (s, i) => technologies!.indexOf(s) !== i,
    );
    if (repeated.length > 0) {
      problem(`"technologies" repeats ${[...new Set(repeated)].join(', ')}`);
    }
    if (technologies.length > BLOG_MAX_TECHNOLOGIES) {
      problem(`"technologies" has more than ${BLOG_MAX_TECHNOLOGIES} items`);
    }
    const unknown = technologies.filter(
      (s) => !options.knownTechnologies.has(s),
    );
    if (unknown.length > 0) {
      problem(
        `unknown technology slug(s): ${unknown.join(', ')} (add them to technologies in prisma/seed-data.ts)`,
      );
    }
  }

  let publishedAt: Date | undefined;
  const rawDate = data.publishedAt;
  if (rawDate === undefined) {
    if (options.requireShared) problem('"publishedAt" is required');
  } else {
    const parsed =
      typeof rawDate === 'string' ? parsePublishedAt(rawDate) : null;
    if (!parsed) {
      problem(
        `"publishedAt" must be a valid date "YYYY-MM-DD" (or ISO 8601 date-time), got ${JSON.stringify(rawDate)}`,
      );
    } else {
      publishedAt = parsed;
    }
  }

  if (errors.length > 0 || !title || !slug || !excerpt || !seoDescription) {
    return { result: null, errors };
  }
  return {
    result: {
      translation: {
        title,
        slug,
        excerpt,
        content: body,
        seoTitle,
        seoDescription,
      },
      technologies,
      publishedAt,
    },
    errors,
  };
}

/**
 * Reads and validates every post of `dir`. Returns null when the directory
 * does not exist. Throws one BlogContentError listing every problem found
 * (each line names its file).
 */
export function loadBlogContent(
  dir: string,
  knownTechnologies: ReadonlySet<string>,
): LoadedBlogContent | null {
  if (!existsSync(dir)) return null;

  const pairs = new Map<string, Partial<Record<SeedLocale, string>>>();
  const ignored: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const match = entry.isFile() ? POST_FILE.exec(entry.name) : null;
    if (!match) {
      ignored.push(entry.name);
      continue;
    }
    const [, key, locale] = match;
    const pair = pairs.get(key) ?? {};
    pair[locale === 'es' ? 'ES' : 'EN'] = entry.name;
    pairs.set(key, pair);
  }

  const errors: string[] = [];
  const posts: BlogPostSeed[] = [];
  for (const key of [...pairs.keys()].sort()) {
    const pair = pairs.get(key)!;
    if (!pair.ES || !pair.EN) {
      const present = (pair.ES ?? pair.EN)!;
      errors.push(
        `${present}: missing its pair ${key}.${pair.ES ? 'en' : 'es'}.md (every post needs ES and EN)`,
      );
      continue;
    }

    const parsed: Partial<Record<SeedLocale, ParsedTranslation>> = {};
    for (const locale of ['ES', 'EN'] as const) {
      const file = pair[locale]!;
      try {
        const { data, body } = parseFrontmatter(
          readFileSync(join(dir, file), 'utf8'),
          file,
        );
        const { result, errors: fileErrors } = validateBlogFile(
          data,
          body,
          file,
          { requireShared: locale === 'ES', knownTechnologies },
        );
        errors.push(...fileErrors);
        if (result) parsed[locale] = result;
      } catch (error) {
        if (!(error instanceof BlogContentError)) throw error;
        errors.push(error.message);
      }
    }
    const es = parsed.ES;
    const en = parsed.EN;
    if (!es || !en) continue;

    if (es.translation.slug !== key) {
      errors.push(
        `${pair.ES}: "slug" is "${es.translation.slug}" but the file name says "${key}" (name the files after the ES slug)`,
      );
    }
    if (
      en.technologies !== undefined &&
      en.technologies.join(',') !== es.technologies!.join(',')
    ) {
      errors.push(
        `${pair.EN}: "technologies" must match ${pair.ES} (${JSON.stringify(es.technologies)}) or be omitted`,
      );
    }
    if (
      en.publishedAt !== undefined &&
      en.publishedAt.getTime() !== es.publishedAt!.getTime()
    ) {
      errors.push(
        `${pair.EN}: "publishedAt" must match ${pair.ES} or be omitted`,
      );
    }
    posts.push({
      key,
      technologies: es.technologies!,
      publishedAt: es.publishedAt!,
      translations: { ES: es.translation, EN: en.translation },
    });
  }

  // Slugs are unique per locale.
  for (const locale of ['ES', 'EN'] as const) {
    const owners = new Map<string, string>();
    for (const post of posts) {
      const slug = post.translations[locale].slug;
      const owner = owners.get(slug);
      if (owner) {
        errors.push(
          `${post.key}.${locale.toLowerCase()}.md: slug "${slug}" is also used by ${owner}.${locale.toLowerCase()}.md`,
        );
      } else {
        owners.set(slug, post.key);
      }
    }
  }

  if (errors.length > 0) {
    throw new BlogContentError(
      `invalid blog seed content in ${dir}:\n  - ${errors.join('\n  - ')}`,
    );
  }
  // Oldest first, so creation order follows publication order.
  posts.sort(
    (a, b) =>
      a.publishedAt.getTime() - b.publishedAt.getTime() ||
      a.key.localeCompare(b.key),
  );
  return { posts, ignored };
}

/**
 * Create-only (natural key: ES slug): creates each missing post PUBLISHED in ES
 * and EN, with `authorId` as author and its technologies in order. Existing
 * posts, even edited or soft-deleted from the admin, are never touched.
 */
export async function seedBlogPosts(
  prisma: PrismaClient,
  posts: BlogPostSeed[],
  authorId: string | null,
  technologyIds: ReadonlyMap<string, string>,
): Promise<{ created: number; kept: number }> {
  let created = 0;
  for (const post of posts) {
    const existing = await prisma.blogPostTranslation.findUnique({
      where: { locale_slug: { locale: 'ES', slug: post.key } },
      select: { id: true },
    });
    if (existing) continue;

    const enSlug = post.translations.EN.slug;
    const enOwner = await prisma.blogPostTranslation.findUnique({
      where: { locale_slug: { locale: 'EN', slug: enSlug } },
      select: { id: true },
    });
    if (enOwner) {
      throw new BlogContentError(
        `${post.key}.en.md: the EN slug "${enSlug}" is already used by another post in the database`,
      );
    }
    const linked = post.technologies.map((slug) => {
      const id = technologyIds.get(slug);
      if (!id) {
        throw new BlogContentError(
          `${post.key}.es.md: unknown technology slug "${slug}"`,
        );
      }
      return id;
    });

    await prisma.$transaction(async (tx) => {
      const { id } = await tx.blogPost.create({
        data: { authorId },
        select: { id: true },
      });
      for (const locale of ['ES', 'EN'] as const) {
        await tx.blogPostTranslation.create({
          data: {
            ...post.translations[locale],
            blogPostId: id,
            locale,
            status: 'PUBLISHED',
            publishedAt: post.publishedAt,
          },
        });
      }
      await tx.blogPostTechnology.createMany({
        data: linked.map((technologyId, index) => ({
          blogPostId: id,
          technologyId,
          sortOrder: index + 1,
        })),
      });
    });
    created++;
  }
  return { created, kept: posts.length - created };
}
