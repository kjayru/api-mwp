import { UnprocessableEntityException } from '@nestjs/common';
import type { Locale } from '../generated/prisma/enums.js';

/**
 * 422 for content that cannot be (or stay) published. `details.missing` lists the
 * missing fields (API names) so the admin can highlight them; `message` lists
 * them in Spanish for display.
 */
export function incompleteForPublication(
  locale: Locale,
  missing: string[],
  labels: Record<string, string>,
  context: 'publish' | 'keep-published',
): UnprocessableEntityException {
  const list = missing.map((field) => labels[field] ?? field).join(', ');
  const message =
    context === 'publish'
      ? `No se puede publicar la versión ${locale}. Falta: ${list}`
      : `La versión ${locale} está publicada y no puede quedar incompleta. Falta: ${list}`;
  return new UnprocessableEntityException({
    message,
    error: 'Unprocessable Entity',
    details: { locale, missing },
  });
}

export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}
