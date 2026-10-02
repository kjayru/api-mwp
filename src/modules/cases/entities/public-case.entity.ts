// Response shapes of the public case endpoints (GET /cases, GET /cases/:slug).
import type { CaseType } from '../../../generated/prisma/enums.js';

export interface TechnologyChip {
  name: string;
  slug: string;
}

export interface PublicCaseListItem {
  slug: string;
  title: string;
  tagline: string | null;
  summary: string;
  type: CaseType;
  industry: string | null;
  year: number | null;
  coverImageUrl: string | null;
  technologies: TechnologyChip[];
}

export interface PublicTextBlock {
  type: 'text';
  title: string;
  body: string;
}

export interface PublicGalleryImage {
  url: string;
  /** Alt text in the requested locale; null when it was not written. */
  alt: string | null;
}

export interface PublicGalleryBlock {
  type: 'gallery';
  images: PublicGalleryImage[];
  caption: string | null;
}

export interface PublicMetricsBlock {
  type: 'metrics';
  title: string | null;
  items: { value: string; label: string }[];
}

export type PublicCaseBlock =
  PublicTextBlock | PublicGalleryBlock | PublicMetricsBlock;

export interface PublicCaseDetail extends PublicCaseListItem {
  /** null when the case is anonymised (or has no client). */
  client: string | null;
  blocks: PublicCaseBlock[];
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  /** Slug of each locale, or null when that locale is not published. */
  alternates: { es: string | null; en: string | null };
  /** Next published case in this locale (wraps around); null if this is the only one. */
  next: { slug: string; title: string } | null;
}
