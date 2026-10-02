// Validation and public resolution of CaseTranslation.blocks (a Json column).
// The stored shape is CaseBlock (entities/case-block.entity.ts); the public API
// returns PublicCaseBlock, with gallery image ids resolved to { url, alt }.
import { BadRequestException } from '@nestjs/common';
import type { Locale } from '../../generated/prisma/enums.js';
import type {
  CaseBlock,
  GalleryBlock,
  MetricItem,
  MetricsBlock,
  TextBlock,
} from './entities/case-block.entity.js';
import type { PublicCaseBlock } from './entities/public-case.entity.js';

export const BLOCK_LIMITS = {
  blocks: 50,
  title: 200,
  body: 20_000,
  caption: 300,
  galleryImages: 50,
  metricItems: 12,
  metricValue: 40,
  metricLabel: 200,
} as const;

export const BLOCK_TYPES = ['text', 'gallery', 'metrics'] as const;

const ALLOWED_KEYS: Record<CaseBlock['type'], readonly string[]> = {
  text: ['type', 'title', 'body'],
  gallery: ['type', 'imageIds', 'caption'],
  metrics: ['type', 'title', 'items'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class BlockErrors {
  readonly messages: string[] = [];

  add(path: string, message: string): void {
    this.messages.push(`${path} ${message}`);
  }

  /** Required string up to `max` characters (may be empty while drafting). */
  string(path: string, value: unknown, max: number): string | undefined {
    if (typeof value !== 'string') {
      this.add(path, 'debe ser un texto');
      return undefined;
    }
    if (value.length > max) {
      this.add(path, `no debe superar ${max} caracteres`);
    }
    return value;
  }

  /** Optional string: undefined and null mean "absent". */
  optionalString(
    path: string,
    value: unknown,
    max: number,
  ): string | undefined {
    return value === undefined || value === null
      ? undefined
      : this.string(path, value, max);
  }
}

/**
 * Validates `blocks` from an admin PATCH against the CaseBlock union and returns
 * a normalised copy (optional nulls removed). Gallery `imageIds` must be ids of
 * this case's images (`caseImageIds`). Throws 400 listing every problem.
 */
export function validateCaseBlocks(
  input: unknown,
  caseImageIds: ReadonlySet<string>,
): CaseBlock[] {
  if (!Array.isArray(input)) {
    throw new BadRequestException(['blocks debe ser un array']);
  }
  if (input.length > BLOCK_LIMITS.blocks) {
    throw new BadRequestException([
      `blocks admite como máximo ${BLOCK_LIMITS.blocks} bloques`,
    ]);
  }

  const errors = new BlockErrors();
  const blocks: CaseBlock[] = [];

  input.forEach((raw: unknown, index) => {
    const path = `blocks[${index}]`;
    if (!isRecord(raw)) {
      errors.add(path, 'debe ser un objeto');
      return;
    }
    const type = raw.type;
    if (!BLOCK_TYPES.includes(type as CaseBlock['type'])) {
      errors.add(`${path}.type`, 'debe ser "text", "gallery" o "metrics"');
      return;
    }
    const blockType = type as CaseBlock['type'];
    for (const key of Object.keys(raw)) {
      if (!ALLOWED_KEYS[blockType].includes(key)) {
        errors.add(
          `${path}.${key}`,
          `no está permitido en un bloque "${blockType}"`,
        );
      }
    }

    if (blockType === 'text') {
      const title = errors.string(
        `${path}.title`,
        raw.title,
        BLOCK_LIMITS.title,
      );
      const body = errors.string(`${path}.body`, raw.body, BLOCK_LIMITS.body);
      if (title !== undefined && body !== undefined) {
        blocks.push({ type: 'text', title, body } satisfies TextBlock);
      }
      return;
    }

    if (blockType === 'gallery') {
      const caption = errors.optionalString(
        `${path}.caption`,
        raw.caption,
        BLOCK_LIMITS.caption,
      );
      const imageIds = validateImageIds(
        errors,
        `${path}.imageIds`,
        raw.imageIds,
        caseImageIds,
      );
      if (imageIds) {
        const block: GalleryBlock = { type: 'gallery', imageIds };
        if (caption !== undefined) block.caption = caption;
        blocks.push(block);
      }
      return;
    }

    const title = errors.optionalString(
      `${path}.title`,
      raw.title,
      BLOCK_LIMITS.title,
    );
    const items = validateMetricItems(errors, `${path}.items`, raw.items);
    if (items) {
      const block: MetricsBlock = { type: 'metrics', items };
      if (title !== undefined) block.title = title;
      blocks.push(block);
    }
  });

  if (errors.messages.length > 0) {
    throw new BadRequestException(errors.messages);
  }
  return blocks;
}

function validateImageIds(
  errors: BlockErrors,
  path: string,
  value: unknown,
  caseImageIds: ReadonlySet<string>,
): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.add(path, 'debe ser un array de ids de imágenes');
    return undefined;
  }
  if (value.length > BLOCK_LIMITS.galleryImages) {
    errors.add(
      path,
      `admite como máximo ${BLOCK_LIMITS.galleryImages} imágenes`,
    );
  }
  const seen = new Set<string>();
  value.forEach((id: unknown, i) => {
    if (typeof id !== 'string') {
      errors.add(`${path}[${i}]`, 'debe ser un id (texto)');
    } else if (!caseImageIds.has(id)) {
      errors.add(`${path}[${i}]`, `("${id}") no es una imagen de este caso`);
    } else if (seen.has(id)) {
      errors.add(`${path}[${i}]`, `("${id}") está repetida`);
    } else {
      seen.add(id);
    }
  });
  return value.filter((id): id is string => typeof id === 'string');
}

function validateMetricItems(
  errors: BlockErrors,
  path: string,
  value: unknown,
): MetricItem[] | undefined {
  if (!Array.isArray(value)) {
    errors.add(path, 'debe ser un array de { value, label }');
    return undefined;
  }
  if (value.length > BLOCK_LIMITS.metricItems) {
    errors.add(path, `admite como máximo ${BLOCK_LIMITS.metricItems} métricas`);
  }
  const items: MetricItem[] = [];
  value.forEach((item: unknown, i) => {
    const itemPath = `${path}[${i}]`;
    if (!isRecord(item)) {
      errors.add(itemPath, 'debe ser un objeto { value, label }');
      return;
    }
    for (const key of Object.keys(item)) {
      if (key !== 'value' && key !== 'label') {
        errors.add(`${itemPath}.${key}`, 'no está permitido');
      }
    }
    const metricValue = errors.string(
      `${itemPath}.value`,
      item.value,
      BLOCK_LIMITS.metricValue,
    );
    const label = errors.string(
      `${itemPath}.label`,
      item.label,
      BLOCK_LIMITS.metricLabel,
    );
    if (metricValue !== undefined && label !== undefined) {
      items.push({ value: metricValue, label });
    }
  });
  return items;
}

/** Reads stored blocks defensively: anything that is not an array counts as []. */
export function storedBlocks(value: unknown): CaseBlock[] {
  return Array.isArray(value) ? (value as CaseBlock[]) : [];
}

/** Removes `imageId` from every gallery block. Returns null when nothing changed. */
export function removeImageFromBlocks(
  value: unknown,
  imageId: string,
): CaseBlock[] | null {
  let changed = false;
  const blocks = storedBlocks(value).map((block) => {
    if (
      isRecord(block) &&
      block.type === 'gallery' &&
      Array.isArray(block.imageIds) &&
      block.imageIds.includes(imageId)
    ) {
      changed = true;
      return {
        ...block,
        imageIds: block.imageIds.filter((id) => id !== imageId),
      };
    }
    return block;
  });
  return changed ? blocks : null;
}

export interface ResolvableImage {
  id: string;
  url: string;
  alt: unknown;
}

/** `alt` Json `{ "ES": "...", "EN": "..." }` -> the text for `locale`, or null. */
export function altFor(alt: unknown, locale: Locale): string | null {
  if (!isRecord(alt)) return null;
  const text = alt[locale];
  return typeof text === 'string' && text.trim() !== '' ? text : null;
}

/**
 * Stored blocks -> public blocks for one locale: gallery `imageIds` become
 * `images: [{ url, alt }]` (unknown ids skipped); galleries without images,
 * metrics without items, empty text blocks and malformed blocks are dropped.
 */
export function resolvePublicBlocks(
  value: unknown,
  images: readonly ResolvableImage[],
  locale: Locale,
): PublicCaseBlock[] {
  const byId = new Map(images.map((image) => [image.id, image]));
  const result: PublicCaseBlock[] = [];

  for (const block of storedBlocks(value) as unknown[]) {
    if (!isRecord(block)) continue;

    if (block.type === 'text') {
      const title = typeof block.title === 'string' ? block.title : '';
      const body = typeof block.body === 'string' ? block.body : '';
      if (title.trim() === '' && body.trim() === '') continue;
      result.push({ type: 'text', title, body });
    } else if (block.type === 'gallery') {
      const ids = Array.isArray(block.imageIds) ? block.imageIds : [];
      const resolved = ids
        .map((id) => (typeof id === 'string' ? byId.get(id) : undefined))
        .filter((image) => image !== undefined)
        .map((image) => ({ url: image.url, alt: altFor(image.alt, locale) }));
      if (resolved.length === 0) continue;
      result.push({
        type: 'gallery',
        images: resolved,
        caption: typeof block.caption === 'string' ? block.caption : null,
      });
    } else if (block.type === 'metrics') {
      const items = (Array.isArray(block.items) ? block.items : []).filter(
        (item): item is MetricItem =>
          isRecord(item) &&
          typeof item.value === 'string' &&
          typeof item.label === 'string',
      );
      if (items.length === 0) continue;
      result.push({
        type: 'metrics',
        title: typeof block.title === 'string' ? block.title : null,
        items: items.map(({ value, label }) => ({ value, label })),
      });
    }
  }
  return result;
}
