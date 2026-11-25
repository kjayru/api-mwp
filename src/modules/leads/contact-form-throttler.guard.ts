import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Contact form submissions allowed per hour and per IP. */
export const CONTACT_FORM_THROTTLE = { ttl: 3_600_000, limit: 5 } as const;

const MESSAGES = {
  es: 'Has enviado demasiados mensajes. Inténtalo de nuevo más tarde o escríbenos por WhatsApp.',
  en: 'You have sent too many messages. Try again later or write to us on WhatsApp.',
};

/**
 * Limits POST /leads by client IP (`req.ip`, see TRUST_PROXY) and answers 429
 * in the visitor's language, in the shared error format with
 * `details.reason: "rate_limit"` (like the chat).
 */
@Injectable()
export class ContactFormThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return `ip:${String(req.ip ?? req.socket?.remoteAddress ?? 'unknown')}`;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest<Record<string, any>>();
    const locale = req.body?.locale === 'en' ? 'en' : 'es';
    throw new HttpException(
      {
        message: MESSAGES[locale],
        error: 'Too Many Requests',
        details: { reason: 'rate_limit' },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
