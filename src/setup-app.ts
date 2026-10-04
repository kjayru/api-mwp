import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import type { Env } from './config/env.js';
import { uploadsRoot } from './modules/uploads/storage/local-file-storage.js';

export const UPLOADS_ROUTE = '/uploads';
export const JSON_BODY_LIMIT = '1mb';

/** Global HTTP setup shared by main.ts and the e2e tests. Routes end up as /api/v1/... */
export function setupApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  // Express defaults to 100 kB; a blog post may carry up to 100 000 characters
  // of Markdown (more bytes once UTF-8 and JSON-escaped). Registered before
  // init, so Nest skips its default JSON parser.
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
  serveUploads(app, uploadsRoot(config));
  app.enableShutdownHooks();
}

/**
 * Serves UPLOADS_DIR at /uploads (outside the /api prefix). File names are
 * random and never reused, so they are cached for a year as immutable. No
 * directory listing, no index files, no dotfiles, nothing outside the root
 * (`send` rejects ".." traversal); misses fall through to the JSON 404.
 */
function serveUploads(app: NestExpressApplication, root: string): void {
  app.useStaticAssets(root, {
    prefix: UPLOADS_ROUTE,
    index: false,
    redirect: false,
    dotfiles: 'ignore',
    fallthrough: true,
    maxAge: '365d',
    immutable: true,
    setHeaders: (res: Response) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });
}
