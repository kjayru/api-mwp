import { plainToInstance } from 'class-transformer';
import { describe, expect, it } from 'vitest';
import { ToBoolean, ToLowerCase, Trim } from './transforms.js';

class Dto {
  @Trim() name?: unknown;
  @ToBoolean() flag?: unknown;
  @ToLowerCase() kind?: unknown;
}
const conv = (o: object) => plainToInstance(Dto, o);

describe('transforms', () => {
  it('Trim trims strings and leaves other types alone', () => {
    expect(conv({ name: '  hola  ' }).name).toBe('hola');
    expect(conv({ name: 5 }).name).toBe(5);
    expect(conv({ name: null }).name).toBeNull();
  });

  it('ToBoolean maps "true"/"false" and leaves the rest', () => {
    expect(conv({ flag: 'true' }).flag).toBe(true);
    expect(conv({ flag: 'false' }).flag).toBe(false);
    expect(conv({ flag: 'yes' }).flag).toBe('yes');
    expect(conv({ flag: true }).flag).toBe(true);
  });

  it('ToLowerCase lowercases strings only', () => {
    expect(conv({ kind: 'PUBLISHED' }).kind).toBe('published');
    expect(conv({ kind: 7 }).kind).toBe(7);
  });
});
