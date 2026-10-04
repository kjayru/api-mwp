import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BlogContentError,
  loadBlogContent,
  parseFrontmatter,
  parsePublishedAt,
  validateBlogFile,
} from './blog-content.js';

const FIXTURES = fileURLToPath(
  new URL('../test/fixtures/blog/', import.meta.url),
);
const KNOWN = new Set(['nestjs', 'prisma', 'nextjs', 'react']);

function frontmatter(
  fields: Record<string, unknown>,
  body = 'Cuerpo.',
): string {
  const lines = Object.entries(fields).map(
    ([key, value]) => `${key}: ${JSON.stringify(value)}`,
  );
  return ['---', ...lines, '---', body].join('\n');
}

const ES = {
  title: 'Título',
  slug: 'mi-post',
  excerpt: 'Extracto',
  seoDescription: 'Descripción SEO',
  technologies: ['nestjs'],
  publishedAt: '2026-09-12',
};
const EN = {
  title: 'Title',
  slug: 'my-post',
  excerpt: 'Excerpt',
  seoDescription: 'SEO description',
};

describe('parseFrontmatter', () => {
  it('parses JSON values and returns the body', () => {
    const { data, body } = parseFrontmatter(
      '---\ntitle: "Hola: mundo"\ntechnologies: ["a", "b"]\n\nseoTitle: null\n---\n\n# Body\n\ntext\n\n',
      'x.es.md',
    );
    expect(data).toEqual({
      title: 'Hola: mundo',
      technologies: ['a', 'b'],
      seoTitle: null,
    });
    expect(body).toBe('# Body\n\ntext');
  });

  it('accepts a BOM and Windows line endings', () => {
    const { data, body } = parseFrontmatter(
      '﻿---\r\ntitle: "T"\r\n---\r\nuno\r\ndos\r\n',
      'x.es.md',
    );
    expect(data).toEqual({ title: 'T' });
    expect(body).toBe('uno\ndos');
  });

  it.each([
    ['title: "T"\n---\nbody', /must start with a frontmatter block/],
    ['---\ntitle: "T"\nbody', /not closed/],
    [
      '---\ntitle: T sin comillas\n---\n',
      /line 2: the value of "title" is not valid JSON/,
    ],
    ["---\ntitle: 'simple'\n---\n", /not valid JSON.*double quotes/],
    ['---\n- item\n---\n', /line 2: expected `key: <JSON value>`/],
    ['---\nauthor: "Wile"\n---\n', /unknown key "author"/],
    ['---\ntitle: "a"\ntitle: "b"\n---\n', /line 3: duplicated key "title"/],
  ])('rejects %j', (text, message) => {
    expect(() => parseFrontmatter(text, 'post.es.md')).toThrow(
      BlogContentError,
    );
    expect(() => parseFrontmatter(text, 'post.es.md')).toThrow(message);
    expect(() => parseFrontmatter(text, 'post.es.md')).toThrow(/^post\.es\.md/);
  });
});

describe('parsePublishedAt', () => {
  it('accepts YYYY-MM-DD (UTC midnight) and ISO date-times', () => {
    expect(parsePublishedAt('2026-09-12')?.toISOString()).toBe(
      '2026-09-12T00:00:00.000Z',
    );
    expect(parsePublishedAt('2026-09-12T10:30:00-05:00')?.toISOString()).toBe(
      '2026-09-12T15:30:00.000Z',
    );
  });

  it.each(['2026-02-30', '2026-13-01', '12/09/2026', 'ayer', '2026-9-1'])(
    'rejects %s',
    (value) => {
      expect(parsePublishedAt(value)).toBeNull();
    },
  );
});

describe('validateBlogFile', () => {
  const validate = (
    data: Record<string, unknown>,
    body = 'Cuerpo',
    requireShared = true,
  ) =>
    validateBlogFile(data, body, 'f.es.md', {
      requireShared,
      knownTechnologies: KNOWN,
    });

  it('returns the trimmed translation, technologies and date', () => {
    const { result, errors } = validate({ ...ES, title: '  Título  ' });
    expect(errors).toEqual([]);
    expect(result).toEqual({
      translation: {
        title: 'Título',
        slug: 'mi-post',
        excerpt: 'Extracto',
        content: 'Cuerpo',
        seoTitle: null,
        seoDescription: 'Descripción SEO',
      },
      technologies: ['nestjs'],
      publishedAt: new Date('2026-09-12T00:00:00Z'),
    });
  });

  it('reports every problem, each naming the file', () => {
    const { result, errors } = validate(
      {
        title: '',
        slug: 'Mal Slug',
        seoDescription: 'x'.repeat(161),
        technologies: ['nestjs', 'nestjs', 'vue'],
        publishedAt: '2026-02-30',
      },
      '   ',
    );
    expect(result).toBeNull();
    expect(errors).toEqual([
      'f.es.md: "title" must not be empty',
      expect.stringContaining('f.es.md: "slug" "Mal Slug" must be lowercase'),
      'f.es.md: "excerpt" is required',
      'f.es.md: "seoDescription" has 161 characters (max 160)',
      'f.es.md: the Markdown body is empty',
      'f.es.md: "technologies" repeats nestjs',
      expect.stringContaining('f.es.md: unknown technology slug(s): vue'),
      expect.stringContaining('f.es.md: "publishedAt" must be a valid date'),
    ]);
  });

  it('requires technologies and publishedAt only in the ES file', () => {
    expect(validate(EN, 'Body', true).errors).toEqual([
      'f.es.md: "technologies" is required',
      'f.es.md: "publishedAt" is required',
    ]);
    expect(validate(EN, 'Body', false).errors).toEqual([]);
  });

  it('checks the types', () => {
    const { errors } = validate({ ...ES, title: 3, technologies: 'nestjs' });
    expect(errors).toEqual([
      'f.es.md: "title" must be a string',
      'f.es.md: "technologies" must be an array of technology slugs',
    ]);
  });
});

describe('loadBlogContent', () => {
  let dir: string;
  const write = (name: string, text: string) =>
    writeFileSync(join(dir, name), text);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mwp-blog-seed-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads the fixtures, oldest first, ignoring other files', () => {
    const content = loadBlogContent(FIXTURES, KNOWN);
    expect(content?.ignored).toEqual(['README.md']);
    expect(content?.posts.map((p) => p.key)).toEqual([
      'primer-articulo',
      'segundo-articulo',
    ]);
    const [first, second] = content!.posts;
    expect(first.technologies).toEqual(['nestjs', 'prisma']);
    expect(first.publishedAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(first.translations.EN).toMatchObject({
      slug: 'first-post',
      seoTitle: null,
    });
    expect(first.translations.ES.content).toMatch(/^# Primer artículo\n/);
    expect(second.translations.ES.seoTitle).toBe(
      'Segundo artículo | Blog de prueba',
    );
  });

  it('returns null for a missing directory and no posts for an empty one', () => {
    expect(loadBlogContent(join(dir, 'nope'), KNOWN)).toBeNull();
    expect(loadBlogContent(dir, KNOWN)).toEqual({ posts: [], ignored: [] });
  });

  it('requires both locales', () => {
    write('mi-post.es.md', frontmatter(ES));
    expect(() => loadBlogContent(dir, KNOWN)).toThrow(
      'mi-post.es.md: missing its pair mi-post.en.md',
    );
  });

  it('requires the ES file name to be the ES slug', () => {
    write('otro.es.md', frontmatter(ES));
    write('otro.en.md', frontmatter(EN));
    expect(() => loadBlogContent(dir, KNOWN)).toThrow(
      'otro.es.md: "slug" is "mi-post" but the file name says "otro"',
    );
  });

  it('requires EN technologies and publishedAt to match ES when present', () => {
    write('mi-post.es.md', frontmatter(ES));
    write(
      'mi-post.en.md',
      frontmatter({
        ...EN,
        technologies: ['react'],
        publishedAt: '2026-09-13',
      }),
    );
    const error = (() => {
      try {
        loadBlogContent(dir, KNOWN);
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error).toBeInstanceOf(BlogContentError);
    expect(error?.message).toContain(
      'mi-post.en.md: "technologies" must match mi-post.es.md',
    );
    expect(error?.message).toContain(
      'mi-post.en.md: "publishedAt" must match mi-post.es.md',
    );

    write(
      'mi-post.en.md',
      frontmatter({
        ...EN,
        technologies: ['nestjs'],
        publishedAt: '2026-09-12',
      }),
    );
    expect(loadBlogContent(dir, KNOWN)?.posts).toHaveLength(1);
  });

  it('rejects an EN slug used by two posts', () => {
    write('mi-post.es.md', frontmatter(ES));
    write('mi-post.en.md', frontmatter(EN));
    write('otro-post.es.md', frontmatter({ ...ES, slug: 'otro-post' }));
    write('otro-post.en.md', frontmatter(EN));
    expect(() => loadBlogContent(dir, KNOWN)).toThrow(
      'otro-post.en.md: slug "my-post" is also used by mi-post.en.md',
    );
  });

  it('lists the problems of every file in one error', () => {
    write('a.es.md', 'sin frontmatter');
    write('a.en.md', frontmatter(EN));
    write('b.es.md', frontmatter({ ...ES, slug: 'b', technologies: ['vue'] }));
    write('b.en.md', frontmatter(EN, ''));
    expect(() => loadBlogContent(dir, KNOWN)).toThrow(
      /a\.es\.md: must start[\s\S]*b\.es\.md: unknown technology[\s\S]*b\.en\.md: the Markdown body is empty/,
    );
  });
});
