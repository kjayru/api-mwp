import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../config/env.js';
import { invalidSecret, previewDisabled } from './preview-errors.js';

export const PREVIEW_SECRET_HEADER = 'x-preview-secret';

/** Constant-time comparison: both sides are hashed so the buffers have equal length. */
export function secretsMatch(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Guards the public preview endpoints with the secret shared with front-mwp
 * (`x-preview-secret`). 503 when PREVIEW_SECRET is not configured.
 */
@Injectable()
export class PreviewSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('PREVIEW_SECRET', { infer: true });
    if (!expected) throw previewDisabled();
    const header = context.switchToHttp().getRequest<Request>().headers[
      PREVIEW_SECRET_HEADER
    ];
    if (typeof header !== 'string' || !secretsMatch(header, expected)) {
      throw invalidSecret();
    }
    return true;
  }
}
