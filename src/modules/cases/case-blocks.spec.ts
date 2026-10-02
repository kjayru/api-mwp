import { BadRequestException } from '@nestjs/common';
import {
  altFor,
  BLOCK_LIMITS,
  removeImageFromBlocks,
  resolvePublicBlocks,
  validateCaseBlocks,
} from './case-blocks.js';

/** Messages of the BadRequestException thrown by `fn`. */
function errorsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return body.message;
  }
  throw new Error('expected a BadRequestException');
}

describe('validateCaseBlocks', () => {
  const images = new Set(['img-1', 'img-2']);

  it('accepts the three block types and normalises optional nulls', () => {
    const blocks = validateCaseBlocks(
      [
        { type: 'text', title: 'El reto', body: 'Texto' },
        { type: 'gallery', imageIds: ['img-2', 'img-1'], caption: null },
        { type: 'gallery', imageIds: [], caption: 'Vacía mientras se edita' },
        {
          type: 'metrics',
          title: 'Resultados',
          items: [{ value: '35%', label: 'menos tiempo' }],
        },
        { type: 'metrics', items: [] },
      ],
      images,
    );

    expect(blocks).toEqual([
      { type: 'text', title: 'El reto', body: 'Texto' },
      { type: 'gallery', imageIds: ['img-2', 'img-1'] },
      { type: 'gallery', imageIds: [], caption: 'Vacía mientras se edita' },
      {
        type: 'metrics',
        title: 'Resultados',
        items: [{ value: '35%', label: 'menos tiempo' }],
      },
      { type: 'metrics', items: [] },
    ]);
  });

  it('rejects gallery image ids that do not belong to the case', () => {
    expect(
      errorsOf(() =>
        validateCaseBlocks(
          [{ type: 'gallery', imageIds: ['img-1', 'other-case-img'] }],
          images,
        ),
      ),
    ).toEqual([
      'blocks[0].imageIds[1] ("other-case-img") no es una imagen de este caso',
    ]);
  });

  it('rejects repeated image ids in a gallery', () => {
    expect(
      errorsOf(() =>
        validateCaseBlocks(
          [{ type: 'gallery', imageIds: ['img-1', 'img-1'] }],
          images,
        ),
      ),
    ).toEqual(['blocks[0].imageIds[1] ("img-1") está repetida']);
  });

  it('lists every problem with its path', () => {
    const messages = errorsOf(() =>
      validateCaseBlocks(
        [
          { type: 'video', url: 'x' },
          { type: 'text', title: 3 },
          { type: 'text', title: 'a', body: 'b', extra: true },
          { type: 'metrics', items: [{ value: '1' }, 'nope'] },
          'not-an-object',
        ],
        images,
      ),
    );

    expect(messages).toEqual([
      'blocks[0].type debe ser "text", "gallery" o "metrics"',
      'blocks[1].title debe ser un texto',
      'blocks[1].body debe ser un texto',
      'blocks[2].extra no está permitido en un bloque "text"',
      'blocks[3].items[0].label debe ser un texto',
      'blocks[3].items[1] debe ser un objeto { value, label }',
      'blocks[4] debe ser un objeto',
    ]);
  });

  it('enforces the length limits', () => {
    const messages = errorsOf(() =>
      validateCaseBlocks(
        [
          {
            type: 'text',
            title: 'x'.repeat(BLOCK_LIMITS.title + 1),
            body: 'ok',
          },
          {
            type: 'metrics',
            items: Array.from({ length: BLOCK_LIMITS.metricItems + 1 }, () => ({
              value: '1',
              label: 'l',
            })),
          },
        ],
        images,
      ),
    );
    expect(messages).toEqual([
      `blocks[0].title no debe superar ${BLOCK_LIMITS.title} caracteres`,
      `blocks[1].items admite como máximo ${BLOCK_LIMITS.metricItems} métricas`,
    ]);
  });

  it('accepts at most 50 blocks', () => {
    const block = { type: 'text', title: 't', body: 'b' };
    expect(
      validateCaseBlocks(Array(BLOCK_LIMITS.blocks).fill(block), images),
    ).toHaveLength(50);
    expect(
      errorsOf(() =>
        validateCaseBlocks(Array(BLOCK_LIMITS.blocks + 1).fill(block), images),
      ),
    ).toEqual(['blocks admite como máximo 50 bloques']);
  });

  it('requires an array', () => {
    expect(errorsOf(() => validateCaseBlocks({}, images))).toEqual([
      'blocks debe ser un array',
    ]);
  });
});

describe('removeImageFromBlocks', () => {
  it('removes the id from every gallery block and keeps the rest', () => {
    const blocks = [
      { type: 'text', title: 't', body: 'b' },
      { type: 'gallery', imageIds: ['a', 'b'], caption: 'c' },
      { type: 'gallery', imageIds: ['b'] },
    ];
    expect(removeImageFromBlocks(blocks, 'b')).toEqual([
      { type: 'text', title: 't', body: 'b' },
      { type: 'gallery', imageIds: ['a'], caption: 'c' },
      { type: 'gallery', imageIds: [] },
    ]);
  });

  it('returns null when no block references the image', () => {
    expect(
      removeImageFromBlocks([{ type: 'gallery', imageIds: ['a'] }], 'z'),
    ).toBeNull();
    expect(removeImageFromBlocks(null, 'z')).toBeNull();
  });
});

describe('resolvePublicBlocks', () => {
  const images = [
    {
      id: 'a',
      url: 'https://cdn/a.png',
      alt: { ES: 'Panel', EN: 'Dashboard' },
    },
    { id: 'b', url: 'https://cdn/b.png', alt: { ES: 'Solo ES' } },
  ];

  it('resolves gallery ids to { url, alt } in the requested locale', () => {
    const stored = [
      { type: 'gallery', imageIds: ['b', 'a', 'missing'], caption: 'Capturas' },
    ];

    expect(resolvePublicBlocks(stored, images, 'EN')).toEqual([
      {
        type: 'gallery',
        images: [
          { url: 'https://cdn/b.png', alt: null },
          { url: 'https://cdn/a.png', alt: 'Dashboard' },
        ],
        caption: 'Capturas',
      },
    ]);
    expect(resolvePublicBlocks(stored, images, 'ES')[0]).toMatchObject({
      images: [{ alt: 'Solo ES' }, { alt: 'Panel' }],
    });
  });

  it('drops empty galleries, empty metrics, blank text and malformed blocks', () => {
    const stored = [
      { type: 'gallery', imageIds: [] },
      { type: 'gallery', imageIds: ['missing'] },
      { type: 'metrics', items: [] },
      { type: 'text', title: ' ', body: '' },
      { type: 'unknown' },
      null,
      { type: 'text', title: 'El reto', body: 'Texto' },
      { type: 'metrics', items: [{ value: '1', label: 'uno' }] },
    ];

    expect(resolvePublicBlocks(stored, images, 'ES')).toEqual([
      { type: 'text', title: 'El reto', body: 'Texto' },
      { type: 'metrics', title: null, items: [{ value: '1', label: 'uno' }] },
    ]);
  });

  it('treats non-array stored blocks as empty', () => {
    expect(resolvePublicBlocks({ not: 'an array' }, images, 'ES')).toEqual([]);
  });
});

describe('altFor', () => {
  it('returns the locale text or null', () => {
    expect(altFor({ ES: 'Hola', EN: '' }, 'ES')).toBe('Hola');
    expect(altFor({ ES: 'Hola', EN: '' }, 'EN')).toBeNull();
    expect(altFor(null, 'ES')).toBeNull();
    expect(altFor('text', 'ES')).toBeNull();
  });
});
