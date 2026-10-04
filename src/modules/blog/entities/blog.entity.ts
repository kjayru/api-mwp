// Response shapes of the blog endpoints (public /blog and admin /admin/blog).
import type { PerLocale } from '../../../common/i18n/locale.js';
import type { PublicationStatus } from '../../../generated/prisma/enums.js';
import type { TechnologyChip } from '../../cases/entities/public-case.entity.js';

export interface BlogAuthor {
  name: string;
}

export interface BlogPostLink {
  slug: string;
  title: string;
}

/** `GET /blog` item. */
export interface PublicBlogPostListItem {
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  /** First publication of this locale (ISO 8601). */
  publishedAt: string;
  /** ceil(words / 200), at least 1; code blocks and markup excluded. */
  readingMinutes: number;
  /** null when the author's user no longer exists. */
  author: BlogAuthor | null;
  technologies: TechnologyChip[];
}

/** `GET /blog/:slug` */
export interface PublicBlogPostDetail extends PublicBlogPostListItem {
  /** Raw Markdown. */
  content: string;
  /** Last edit of the post (ISO 8601). */
  updatedAt: string;
  seoTitle: string | null;
  seoDescription: string | null;
  /** Slug of each published locale; null when that locale is not published. */
  alternates: { es: string | null; en: string | null };
  /** Next older published post of this locale (no wraparound). */
  previous: BlogPostLink | null;
  /** Next newer published post of this locale (no wraparound). */
  next: BlogPostLink | null;
}

export interface AdminBlogPostListTranslation {
  title: string;
  slug: string;
  status: PublicationStatus;
  publishedAt: Date | null;
}

/** `GET /admin/blog` item. */
export interface AdminBlogPostListItem {
  id: string;
  coverImageUrl: string | null;
  updatedAt: Date;
  author: BlogAuthor | null;
  translations: PerLocale<AdminBlogPostListTranslation | null>;
}

export interface AdminBlogPostTranslation {
  title: string;
  slug: string;
  excerpt: string | null;
  /** Markdown. */
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
  status: PublicationStatus;
  publishedAt: Date | null;
}

/** Returned by `GET /admin/blog/:id`, POST, PATCH, publish and unpublish. */
export interface AdminBlogPost {
  id: string;
  coverImageUrl: string | null;
  /** Non-deleted technologies, in chip order. */
  technologyIds: string[];
  author: BlogAuthor | null;
  translations: PerLocale<AdminBlogPostTranslation | null>;
  createdAt: Date;
  updatedAt: Date;
}
