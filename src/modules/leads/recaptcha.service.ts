import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';

export const RECAPTCHA_VERIFY_URL =
  'https://www.google.com/recaptcha/api/siteverify';
export const RECAPTCHA_TIMEOUT_MS = 5000;
export const RECAPTCHA_ACTION = 'contact';
export const DEFAULT_RECAPTCHA_MIN_SCORE = 0.5;
export const RECAPTCHA_FAILED_MESSAGE =
  'No pudimos verificar que el envío es de una persona. Inténtalo de nuevo o escríbenos por email.';

interface SiteVerifyResponse {
  success?: boolean;
  score?: number;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

function recaptchaFailed(): BadRequestException {
  return new BadRequestException({
    message: RECAPTCHA_FAILED_MESSAGE,
    error: 'Bad Request',
    details: { reason: 'recaptcha_failed' },
  });
}

/**
 * Google reCAPTCHA v3 check of the contact form (docs/API.md 11.1). Disabled
 * without RECAPTCHA_SECRET_KEY. Fails open when Google cannot be reached.
 */
@Injectable()
export class RecaptchaService {
  private readonly logger = new Logger(RecaptchaService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  get enabled(): boolean {
    return Boolean(this.config.get('RECAPTCHA_SECRET_KEY', { infer: true }));
  }

  /** Resolves when the submission may continue; throws 400 `recaptcha_failed` otherwise. */
  async verify(token: string | undefined, ip?: string): Promise<void> {
    const secret = this.config.get('RECAPTCHA_SECRET_KEY', { infer: true });
    if (!secret) return;
    if (!token) {
      this.logger.warn('reCAPTCHA rejected: token missing');
      throw recaptchaFailed();
    }
    const minScore =
      this.config.get('RECAPTCHA_MIN_SCORE', { infer: true }) ??
      DEFAULT_RECAPTCHA_MIN_SCORE;

    let result: SiteVerifyResponse;
    try {
      const body = new URLSearchParams({ secret, response: token });
      if (ip) body.set('remoteip', ip);
      const response = await fetch(RECAPTCHA_VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(RECAPTCHA_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json: unknown = await response.json();
      if (typeof json !== 'object' || json === null) {
        throw new Error('Unexpected response');
      }
      result = json as SiteVerifyResponse;
    } catch (error) {
      // Never log the error object: it must not be able to carry the secret.
      this.logger.warn(
        `reCAPTCHA unavailable, lead accepted without verification (${
          error instanceof Error ? error.name : 'unknown error'
        })`,
      );
      return;
    }

    const score = typeof result.score === 'number' ? result.score : undefined;
    const passed =
      result.success === true &&
      result.action === RECAPTCHA_ACTION &&
      score !== undefined &&
      score >= minScore;
    // Passes are routine (log); rejections deserve attention (warn).
    this.logger[passed ? 'log' : 'warn'](
      `reCAPTCHA ${passed ? 'passed' : 'rejected'}: success=${String(result.success)} score=${String(score)} action=${String(result.action)} hostname=${String(result.hostname)} error-codes=${JSON.stringify(result['error-codes'] ?? [])}`,
    );
    if (!passed) throw recaptchaFailed();
  }
}
