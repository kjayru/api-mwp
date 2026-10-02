import type { PerLocale } from '../../../common/i18n/locale.js';
import type { PublicationStatus } from '../../../generated/prisma/enums.js';
import type { TechnologyChip } from '../../cases/entities/public-case.entity.js';

/** `GET /services` item. */
export interface PublicService {
  title: string;
  slug: string;
  description: string;
  technologies: TechnologyChip[];
}

export interface AdminServiceTranslation {
  title: string;
  slug: string;
  description: string;
  status: PublicationStatus;
  publishedAt: Date | null;
}

/** `/admin/services` item. */
export interface AdminService {
  id: string;
  sortOrder: number;
  /** Non-deleted technologies, in display order. */
  technologyIds: string[];
  translations: PerLocale<AdminServiceTranslation | null>;
  createdAt: Date;
  updatedAt: Date;
}
