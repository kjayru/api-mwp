// Response shapes of the admin case endpoints (/admin/cases...).
import type {
  CaseType,
  PublicationStatus,
} from '../../../generated/prisma/enums.js';
import type { PerLocale } from '../../../common/i18n/locale.js';
import type { CaseBlock } from './case-block.entity.js';

export interface AdminCaseListTranslation {
  title: string;
  slug: string;
  status: PublicationStatus;
}

export interface AdminCaseListItem {
  id: string;
  type: CaseType;
  sortOrder: number;
  updatedAt: Date;
  coverImageUrl: string | null;
  translations: PerLocale<AdminCaseListTranslation | null>;
}

export interface AdminCaseImage {
  id: string;
  url: string;
  alt: PerLocale<string | null>;
  sortOrder: number;
}

export interface AdminCaseTranslation {
  title: string;
  slug: string;
  tagline: string | null;
  summary: string;
  industry: string | null;
  /** Raw blocks, gallery blocks with `imageIds`. */
  blocks: CaseBlock[];
  seoTitle: string | null;
  seoDescription: string | null;
  status: PublicationStatus;
  publishedAt: Date | null;
}

export interface AdminCase {
  id: string;
  type: CaseType;
  client: string | null;
  anonymizeClient: boolean;
  year: number | null;
  coverImageUrl: string | null;
  includeInKnowledgeBase: boolean;
  sortOrder: number;
  /** Non-deleted technologies, in chip order. */
  technologyIds: string[];
  images: AdminCaseImage[];
  translations: PerLocale<AdminCaseTranslation | null>;
  createdAt: Date;
  updatedAt: Date;
}
