/** Lowercase ASCII words separated by single hyphens: `cortemaestro`, `contaflow-ia`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 120;
export const SLUG_MESSAGE =
  'slug solo admite minúsculas, números y guiones simples (p. ej. "mi-caso-2")';

/**
 * "Diseño & Construcción Ñandú" -> "diseno-construccion-nandu".
 * Returns "" when the text has no usable characters.
 */
export function slugify(text: string, maxLength = SLUG_MAX_LENGTH): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '');
}

/**
 * First free slug among `base`, `base-2`, `base-3`... according to `isTaken`.
 * Used only for generated slugs; an explicit slug that is taken is a 409.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`;
    const candidate =
      base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, '') +
      suffix;
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }
}
