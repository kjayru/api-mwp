import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { detectImageType } from './image-signature.js';
import { FileStorage } from './storage/file-storage.js';

/** Subset of multer's file object used here (in-memory storage). */
export interface UploadedImageFile {
  buffer: Buffer;
  size: number;
}

export interface UploadResult {
  /** Public URL, `${PUBLIC_UPLOADS_URL}/<yyyy>/<mm>/<random>.<ext>`. */
  url: string;
  contentType: string;
  size: number;
}

export const UNSUPPORTED_IMAGE =
  'Formato no permitido. Sube una imagen JPEG, PNG, WebP o AVIF.';
export const MISSING_FILE =
  'Falta la imagen: envíala como multipart/form-data en el campo "file"';

@Injectable()
export class UploadsService {
  constructor(private readonly storage: FileStorage) {}

  async uploadImage(
    file: UploadedImageFile | undefined,
    now = new Date(),
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException(MISSING_FILE);
    }
    const type = detectImageType(file.buffer);
    if (!type) {
      throw new BadRequestException(UNSUPPORTED_IMAGE);
    }
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const name = randomBytes(16).toString('hex');
    const url = await this.storage.save(
      `${year}/${month}/${name}.${type.ext}`,
      file.buffer,
      type.mime,
    );
    return { url, contentType: type.mime, size: file.size };
  }
}
