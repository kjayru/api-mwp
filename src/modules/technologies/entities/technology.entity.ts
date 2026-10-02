import type { PerLocale } from '../../../common/i18n/locale.js';
import type { TechnologyCategory } from '../../../generated/prisma/enums.js';

/** `GET /technologies` item. */
export interface PublicTechnology {
  name: string;
  slug: string;
  category: TechnologyCategory;
  isFeatured: boolean;
  /** In the requested locale; null when not written. */
  description: string | null;
}

/** `/admin/technologies` item. */
export interface AdminTechnology {
  id: string;
  name: string;
  slug: string;
  category: TechnologyCategory;
  isFeatured: boolean;
  sortOrder: number;
  descriptions: PerLocale<string | null>;
  /** Non-deleted cases and services linked to this technology. */
  usage: { cases: number; services: number };
}
