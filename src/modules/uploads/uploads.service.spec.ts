import { BadRequestException } from '@nestjs/common';
import { TINY_PNG } from '../../../test/fixtures/images.js';
import type { FileStorage } from './storage/file-storage.js';
import {
  MISSING_FILE,
  UNSUPPORTED_IMAGE,
  UploadsService,
} from './uploads.service.js';

describe('UploadsService', () => {
  const storage = { save: vi.fn() };
  let service: UploadsService;

  beforeEach(() => {
    vi.resetAllMocks();
    storage.save.mockImplementation((key: string) =>
      Promise.resolve(`http://localhost:3001/uploads/${key}`),
    );
    service = new UploadsService(storage as unknown as FileStorage);
  });

  it('stores a valid image under a random name in a yyyy/mm folder', async () => {
    const result = await service.uploadImage(
      { buffer: TINY_PNG, size: TINY_PNG.length },
      new Date('2026-03-15T12:00:00Z'),
    );

    expect(storage.save).toHaveBeenCalledWith(
      expect.stringMatching(/^2026\/03\/[0-9a-f]{32}\.png$/),
      TINY_PNG,
      'image/png',
    );
    expect(result).toEqual({
      url: expect.stringMatching(
        /^http:\/\/localhost:3001\/uploads\/2026\/03\/[0-9a-f]{32}\.png$/,
      ),
      contentType: 'image/png',
      size: TINY_PNG.length,
    });
  });

  it('never reuses a name', async () => {
    const file = { buffer: TINY_PNG, size: TINY_PNG.length };
    await service.uploadImage(file);
    await service.uploadImage(file);
    const [[first], [second]] = storage.save.mock.calls as [string][];
    expect(first).not.toBe(second);
  });

  it('rejects a file whose bytes are not an allowed image (ignores name/mimetype)', async () => {
    const text = Buffer.from('not an image');
    await expect(
      service.uploadImage({ buffer: text, size: text.length }),
    ).rejects.toThrow(new BadRequestException(UNSUPPORTED_IMAGE));
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects a request without a file', async () => {
    await expect(service.uploadImage(undefined)).rejects.toThrow(
      new BadRequestException(MISSING_FILE),
    );
  });
});
