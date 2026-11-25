import type { Response } from 'express';

/** Interval of the `: keep-alive` comments (proxies drop idle connections). */
export const SSE_KEEPALIVE_MS = 15_000;
export const SSE_KEEPALIVE_COMMENT = ': keep-alive\n\n';

/**
 * One Server-Sent Event: `event: <name>` and a single `data:` line of JSON.
 * JSON.stringify never emits raw newlines, so the frame cannot be broken by
 * the payload.
 */
export function formatSseEvent(event: string, data: unknown): string {
  if (!/^[a-z_]+$/.test(event)) {
    throw new Error(`Invalid SSE event name: ${event}`);
  }
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Writes an SSE response over Express. */
export class SseStream {
  private keepAlive: NodeJS.Timeout | null = null;

  constructor(
    private readonly res: Response,
    private readonly keepAliveMs = SSE_KEEPALIVE_MS,
  ) {}

  get closed(): boolean {
    return this.res.writableEnded || this.res.destroyed;
  }

  open(): void {
    this.res.status(200);
    this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    this.res.setHeader('Cache-Control', 'no-store');
    this.res.setHeader('Connection', 'keep-alive');
    // nginx/Apache-style proxies: do not buffer the stream.
    this.res.setHeader('X-Accel-Buffering', 'no');
    this.res.flushHeaders();
    this.keepAlive = setInterval(() => {
      if (!this.closed) this.res.write(SSE_KEEPALIVE_COMMENT);
    }, this.keepAliveMs);
    this.keepAlive.unref();
  }

  send(event: string, data: unknown): void {
    if (this.closed) return;
    this.res.write(formatSseEvent(event, data));
  }

  close(): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    if (!this.closed) this.res.end();
  }
}
