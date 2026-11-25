import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Page views counted per minute and per IP. */
export const TRACK_THROTTLE = { ttl: 60_000, limit: 60 } as const;

/** Set on the request when the IP went over TRACK_THROTTLE. */
export const TRACK_THROTTLED = Symbol('trackThrottled');

/**
 * Limits POST /track by client IP (`req.ip`, see TRUST_PROXY) without ever
 * failing: over the limit the request is only flagged, and the controller
 * answers 204 without counting the view.
 */
@Injectable()
export class TrackThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return `ip:${String(req.ip ?? req.socket?.remoteAddress ?? 'unknown')}`;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest<Record<symbol, unknown>>();
    req[TRACK_THROTTLED] = true;
  }
}
