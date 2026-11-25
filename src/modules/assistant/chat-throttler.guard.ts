import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Chat messages allowed per minute, per IP and per visitorId (separately). */
export const CHAT_THROTTLE = { ttl: 60_000, limit: 10 } as const;

const MESSAGES = {
  es: 'Demasiados mensajes seguidos. Espera un minuto y vuelve a intentarlo.',
  en: 'Too many messages in a row. Wait a minute and try again.',
};

/** 429 in the visitor's language, in the shared error format. */
function throttled(req: Record<string, any>): HttpException {
  const locale = req.body?.locale === 'en' ? 'en' : 'es';
  return new HttpException(
    {
      message: MESSAGES[locale],
      error: 'Too Many Requests',
      details: { reason: 'rate_limit' },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * Limits by client IP. Behind Apache every request comes from 127.0.0.1
 * until `trust proxy` is configured (Phase 7), so the visitor limit below is
 * the effective one until then.
 */
@Injectable()
export class ChatIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return `ip:${String(req.ip ?? req.socket?.remoteAddress ?? 'unknown')}`;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    throw throttled(context.switchToHttp().getRequest());
  }
}

/** Limits by the visitorId of the body (the IP when it is missing). */
@Injectable()
export class ChatVisitorThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const visitorId: unknown = req.body?.visitorId;
    return typeof visitorId === 'string' && visitorId.length > 0
      ? `visitor:${visitorId.slice(0, 64)}`
      : `no-visitor:${String(req.ip ?? 'unknown')}`;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    throw throttled(context.switchToHttp().getRequest());
  }
}
