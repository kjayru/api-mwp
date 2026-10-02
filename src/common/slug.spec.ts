import { SLUG_MAX_LENGTH, SLUG_PATTERN, slugify, uniqueSlug } from './slug.js';

describe('slugify', () => {
  it.each([
    ['CorteMaestro', 'cortemaestro'],
    ['ContaFlow IA', 'contaflow-ia'],
    ['Diseño & Construcción Ñandú', 'diseno-construccion-nandu'],
    ['  ¿Qué hacemos?  ', 'que-hacemos'],
    ['.NET Core', 'net-core'],
    ['8 Reyes', '8-reyes'],
    ['Web + CMS', 'web-cms'],
    ['!!!', ''],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('caps the length without leaving a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} bcd`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug).toMatch(SLUG_PATTERN);
  });
});

describe('uniqueSlug', () => {
  it('returns the base when it is free', async () => {
    await expect(
      uniqueSlug('caso', () => Promise.resolve(false)),
    ).resolves.toBe('caso');
  });

  it('appends -2, -3... until a free slug is found', async () => {
    const taken = new Set(['caso', 'caso-2']);
    await expect(
      uniqueSlug('caso', (slug) => Promise.resolve(taken.has(slug))),
    ).resolves.toBe('caso-3');
  });

  it('keeps suffixed slugs within the maximum length', async () => {
    const base = 'a'.repeat(SLUG_MAX_LENGTH);
    const slug = await uniqueSlug(base, (s) => Promise.resolve(s === base));
    expect(slug).toHaveLength(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-2')).toBe(true);
  });
});
