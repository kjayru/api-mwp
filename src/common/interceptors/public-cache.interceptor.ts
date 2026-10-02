import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';

export const PUBLIC_CACHE_CONTROL = 'public, max-age=60';

/**
 * Sets `Cache-Control: public, max-age=60` on successful responses only.
 * (`@Header()` is applied before the handler runs, so it would also mark
 * 400/404 errors as cacheable.)
 */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap(() => {
        if (!response.headersSent) {
          response.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL);
        }
      }),
    );
  }
}

/** Public, cacheable GET endpoint (see PublicCacheInterceptor). */
export const PublicCache = () => UseInterceptors(PublicCacheInterceptor);
