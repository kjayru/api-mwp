import { BadRequestException } from '@nestjs/common';
import { assertIsPermutation } from './reorder.js';

describe('assertIsPermutation', () => {
  const existing = ['a', 'b', 'c'];

  it('accepts every existing id exactly once, in any order', () => {
    expect(() => assertIsPermutation(['c', 'a', 'b'], existing)).not.toThrow();
  });

  it.each([
    ['a missing id', ['a', 'b'], 'faltan ids: c'],
    ['an unknown id', ['a', 'b', 'c', 'x'], 'ids desconocidos o eliminados: x'],
    ['a repeated id', ['a', 'b', 'c', 'a'], 'ids repetidos: a'],
  ])('rejects %s with 400', (_, ids, detail) => {
    expect(() => assertIsPermutation(ids, existing)).toThrow(
      BadRequestException,
    );
    expect(() => assertIsPermutation(ids, existing)).toThrow(detail);
  });
});
