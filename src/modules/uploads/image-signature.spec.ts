import { TINY_PNG } from '../../../test/fixtures/images.js';
import { detectImageType } from './image-signature.js';

function ftyp(major: string, compatible: string[]): Buffer {
  const brands = Buffer.from(compatible.join(''), 'latin1');
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16 + brands.length, 0);
  header.write('ftyp', 4, 'latin1');
  header.write(major, 8, 'latin1');
  return Buffer.concat([header, brands, Buffer.alloc(8)]);
}

describe('detectImageType', () => {
  it('detects PNG', () => {
    expect(detectImageType(TINY_PNG)).toEqual({
      mime: 'image/png',
      ext: 'png',
    });
  });

  it('detects JPEG', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(detectImageType(jpeg)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
  });

  it('detects WebP', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x24, 0, 0, 0]),
      Buffer.from('WEBPVP8 ', 'latin1'),
    ]);
    expect(detectImageType(webp)).toEqual({ mime: 'image/webp', ext: 'webp' });
  });

  it('detects AVIF by major or compatible brand', () => {
    expect(detectImageType(ftyp('avif', ['mif1', 'miaf']))).toEqual({
      mime: 'image/avif',
      ext: 'avif',
    });
    expect(detectImageType(ftyp('mif1', ['miaf', 'avif']))?.ext).toBe('avif');
  });

  it.each([
    ['plain text renamed .png', Buffer.from('hello, I am not an image\n')],
    ['an empty file', Buffer.alloc(0)],
    ['HEIC (ftyp without avif)', ftyp('heic', ['mif1', 'heic'])],
    ['MP4', ftyp('isom', ['iso2', 'mp41'])],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')],
    [
      'RIFF that is not WebP (WAV)',
      Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'),
    ],
    ['a truncated PNG signature', TINY_PNG.subarray(0, 4)],
  ])('rejects %s', (_, buffer) => {
    expect(detectImageType(buffer)).toBeNull();
  });
});
