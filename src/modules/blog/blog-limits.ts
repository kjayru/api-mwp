// Field limits of a blog post translation, shared by the admin DTOs and the seed
// content validator (prisma/blog-content.ts). Plain constants only: the seed
// imports this file with Node's type stripping.

export const BLOG_TITLE_MAX = 200;
export const BLOG_EXCERPT_MAX = 500;
/** Markdown body. About 15-20k words, far above a long article. */
export const BLOG_CONTENT_MAX = 100_000;
export const BLOG_SEO_TITLE_MAX = 200;
/** Matches the VARCHAR(160) column. */
export const BLOG_SEO_DESCRIPTION_MAX = 160;
export const BLOG_MAX_TECHNOLOGIES = 20;
