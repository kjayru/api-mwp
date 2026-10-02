// Image type detection from the file's magic bytes. The client's mimetype and
// file name are never trusted: a text file renamed "photo.png" is rejected.

export interface ImageType {
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';
  ext: 'jpg' | 'png' | 'webp' | 'avif';
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function ascii(buffer: Buffer, start: number, end: number): string {
  return buffer.toString('latin1', start, end);
}

/** ISO-BMFF `ftyp` box whose major or compatible brands include avif/avis. */
function isAvif(buffer: Buffer): boolean {
  if (buffer.length < 16 || ascii(buffer, 4, 8) !== 'ftyp') return false;
  const boxSize = buffer.readUInt32BE(0);
  if (boxSize < 16) return false;
  if (AVIF_BRANDS.has(ascii(buffer, 8, 12))) return true;
  const end = Math.min(boxSize, buffer.length);
  // Bytes 12-16 are the minor version; compatible brands follow.
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (AVIF_BRANDS.has(ascii(buffer, offset, offset + 4))) return true;
  }
  return false;
}

/** JPEG, PNG, WebP or AVIF by signature; null for anything else. */
export function detectImageType(buffer: Buffer): ImageType | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    buffer.length >= 12 &&
    ascii(buffer, 0, 4) === 'RIFF' &&
    ascii(buffer, 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (isAvif(buffer)) {
    return { mime: 'image/avif', ext: 'avif' };
  }
  return null;
}
