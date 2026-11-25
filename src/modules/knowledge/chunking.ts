// Turns published case and FAQ translations into knowledge chunks (pure
// functions, no I/O). Each chunk repeats a short header (what the source is) so
// it can be understood and cited on its own.
import { createHash } from 'node:crypto';
import type { CaseType, Locale } from '../../generated/prisma/enums.js';
import { storedBlocks } from '../cases/case-blocks.js';

/** Rough token estimate for ES/EN text (about 4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Upper bound of a chunk, header included. Sections are packed greedily, so
 * a chunk only falls below ~300 tokens when the whole source is that short.
 */
export const MAX_CHUNK_TOKENS = 800;

export const CASE_SOURCE_PREFIX = 'caso';
export const FAQ_SOURCE_PREFIX = 'faq';

export interface ChunkDraft {
  chunkIndex: number;
  /** "caso:<slug>#<n>" or "faq:<id>#<n>". */
  sourceKey: string;
  title: string;
  url: string | null;
  content: string;
  contentHash: string;
  tokenCount: number;
  caseType: CaseType | null;
  technologies: string[];
}

export interface CaseSource {
  caseId: string;
  type: CaseType;
  client: string | null;
  anonymizeClient: boolean;
  year: number | null;
  /** In chip order. */
  technologies: { name: string; slug: string }[];
  locale: Locale;
  title: string;
  slug: string;
  tagline: string | null;
  summary: string;
  industry: string | null;
  blocks: unknown;
}

export interface FaqSource {
  faqId: string;
  locale: Locale;
  question: string;
  answer: string;
}

const CASE_TYPE_LABELS: Record<CaseType, Record<Locale, string>> = {
  SAAS: { ES: 'SaaS', EN: 'SaaS' },
  ECOMMERCE: { ES: 'Ecommerce', EN: 'Ecommerce' },
  WEB_CMS: { ES: 'Web + CMS', EN: 'Website + CMS' },
  TOOL: { ES: 'Herramienta', EN: 'Tool' },
  PLATFORM: { ES: 'Plataforma', EN: 'Platform' },
};

const LABELS = {
  ES: {
    case: 'Caso',
    type: 'Tipo',
    industry: 'Industria',
    year: 'Año',
    client: 'Cliente',
    technologies: 'Tecnologías',
    summary: 'Resumen',
    results: 'Resultados',
    faq: 'Pregunta frecuente',
    anonymousClient: 'el cliente',
  },
  EN: {
    case: 'Case',
    type: 'Type',
    industry: 'Industry',
    year: 'Year',
    client: 'Client',
    technologies: 'Technologies',
    summary: 'Summary',
    results: 'Results',
    faq: 'Frequently asked question',
    anonymousClient: 'the client',
  },
} as const;

/** Public path of a case page on front-mwp (see its caseHref()). */
export function casePath(locale: Locale, slug: string): string {
  return `/${locale.toLowerCase()}/casos/${encodeURIComponent(slug)}`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces every mention of an anonymised client with a neutral word, so the
 * assistant can never quote it. Names shorter than 3 characters are not
 * scrubbed (too many false matches); they are still never written by us.
 */
export function scrubClient(
  text: string,
  client: string | null,
  locale: Locale,
): string {
  const name = client?.trim();
  if (!name || name.length < 3) return text;
  return text.replace(
    new RegExp(escapeRegExp(name), 'giu'),
    LABELS[locale].anonymousClient,
  );
}

/** Splits text longer than `maxChars` at paragraph, then sentence, then hard boundaries. */
export function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  const paragraphs = text.split(/\n{2,}/);
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      pieces.push(paragraph);
      continue;
    }
    const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [
      paragraph,
    ];
    for (const sentence of sentences) {
      for (let i = 0; i < sentence.length; i += maxChars) {
        pieces.push(sentence.slice(i, i + maxChars));
      }
    }
  }
  // Re-pack the pieces greedily so they are as large as allowed.
  const packed: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) packed.push(current);
      current = piece;
    }
  }
  if (current) packed.push(current);
  return packed.map((p) => p.trim()).filter(Boolean);
}

/**
 * Packs sections into chunks of at most MAX_CHUNK_TOKENS (header included),
 * splitting sections that are too long on their own.
 */
export function packSections(header: string, sections: string[]): string[] {
  const maxChars = MAX_CHUNK_TOKENS * 4;
  const budget = Math.max(400, maxChars - header.length - 2);
  const parts = sections
    .map((section) => section.trim())
    .filter(Boolean)
    .flatMap((section) => splitText(section, budget));
  const bodies: string[] = [];
  let current = '';
  for (const part of parts) {
    const candidate = current ? `${current}\n\n${part}` : part;
    if (candidate.length <= budget) {
      current = candidate;
    } else {
      if (current) bodies.push(current);
      current = part;
    }
  }
  if (current) bodies.push(current);
  if (bodies.length === 0) return [header];
  return bodies.map((body) => `${header}\n\n${body}`);
}

function draft(
  base: Omit<ChunkDraft, 'chunkIndex' | 'sourceKey' | 'content' | 'contentHash' | 'tokenCount'>,
  keyPrefix: string,
  contents: string[],
): ChunkDraft[] {
  return contents.map((content, chunkIndex) => ({
    ...base,
    chunkIndex,
    sourceKey: `${keyPrefix}#${chunkIndex}`,
    content,
    contentHash: sha256(content),
    tokenCount: estimateTokens(content),
  }));
}

/**
 * Chunks of one published case translation: header (title, tagline, type,
 * industry, year, client unless anonymised, technologies), summary, text
 * blocks and metrics. Gallery blocks carry no text and are skipped.
 */
export function chunkCase(source: CaseSource): ChunkDraft[] {
  const { locale } = source;
  const labels = LABELS[locale];
  const anonymized = source.anonymizeClient;
  const scrub = (text: string) =>
    anonymized ? scrubClient(text, source.client, locale) : text;

  const meta = [
    `${labels.type}: ${CASE_TYPE_LABELS[source.type][locale]}`,
    source.industry?.trim() ? `${labels.industry}: ${source.industry.trim()}` : null,
    source.year ? `${labels.year}: ${source.year}` : null,
  ].filter(Boolean);
  const headerLines = [
    `${labels.case}: ${source.title.trim()}`,
    source.tagline?.trim() ? source.tagline.trim() : null,
    meta.join(' · '),
    !anonymized && source.client?.trim()
      ? `${labels.client}: ${source.client.trim()}`
      : null,
    source.technologies.length > 0
      ? `${labels.technologies}: ${source.technologies.map((t) => t.name).join(', ')}`
      : null,
  ].filter((line): line is string => Boolean(line));
  const header = scrub(headerLines.join('\n'));

  const sections: string[] = [];
  if (source.summary.trim()) {
    sections.push(`${labels.summary}: ${source.summary.trim()}`);
  }
  for (const block of storedBlocks(source.blocks)) {
    if (block.type === 'text') {
      const title = block.title?.trim();
      const body = block.body?.trim();
      if (!title && !body) continue;
      sections.push([title ? `## ${title}` : null, body].filter(Boolean).join('\n'));
    } else if (block.type === 'metrics') {
      const items = (block.items ?? []).filter(
        (item) => item?.value?.trim() || item?.label?.trim(),
      );
      if (items.length === 0) continue;
      const title = block.title?.trim() || labels.results;
      sections.push(
        [`## ${title}`, ...items.map((item) => `- ${item.value.trim()} ${item.label.trim()}`)].join('\n'),
      );
    }
  }

  const technologies = [
    ...new Set(
      source.technologies.flatMap((t) => [t.name.toLowerCase(), t.slug.toLowerCase()]),
    ),
  ];
  return draft(
    {
      title: source.title.trim(),
      url: casePath(locale, source.slug),
      caseType: source.type,
      technologies,
    },
    `${CASE_SOURCE_PREFIX}:${source.slug}`,
    packSections(header, sections.map(scrub)),
  );
}

/** Chunks of one published FAQ translation (question as header, Markdown answer). */
export function chunkFaq(source: FaqSource): ChunkDraft[] {
  const question = source.question.trim();
  const header = `${LABELS[source.locale].faq}: ${question}`;
  return draft(
    { title: question, url: null, caseType: null, technologies: [] },
    `${FAQ_SOURCE_PREFIX}:${source.faqId}`,
    packSections(header, [source.answer]),
  );
}
