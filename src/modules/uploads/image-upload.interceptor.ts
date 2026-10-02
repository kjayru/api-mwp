import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';

export const UPLOAD_FIELD = 'file';
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

/** In-memory multer (bundled with @nestjs/platform-express) for one image. */
const MulterImageInterceptor = FileInterceptor(UPLOAD_FIELD, {
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
    parts: 12,
  },
});

/**
 * Parses `multipart/form-data` with a single `file` field (max 5 MB) and
 * rewrites multer's errors with clear Spanish messages.
 */
@Injectable()
export class ImageUploadInterceptor implements NestInterceptor {
  private readonly multer = new MulterImageInterceptor();

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      // Only the multipart parsing can reject here; handler errors travel
      // through the returned observable.
      return await this.multer.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw new PayloadTooLargeException(
          `La imagen supera el tamaño máximo de ${MAX_UPLOAD_MB} MB`,
        );
      }
      if (error instanceof BadRequestException) {
        throw new BadRequestException(
          `Envía una sola imagen en el campo multipart "${UPLOAD_FIELD}" (${error.message})`,
        );
      }
      throw error;
    }
  }
}
