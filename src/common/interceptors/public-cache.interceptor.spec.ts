import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_CACHE_CONTROL,
  PublicCacheInterceptor,
} from './public-cache.interceptor.js';

const ctx = (response: object) =>
  ({
    switchToHttp: () => ({ getResponse: () => response }),
  }) as unknown as ExecutionContext;

describe('PublicCacheInterceptor', () => {
  const interceptor = new PublicCacheInterceptor();

  it('sets Cache-Control on a successful response and keeps the payload', async () => {
    const response = { headersSent: false, setHeader: vi.fn() };
    const out = await lastValueFrom(
      interceptor.intercept(ctx(response), {
        handle: () => of({ ok: 1 }),
      } as CallHandler),
    );
    expect(out).toEqual({ ok: 1 });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      PUBLIC_CACHE_CONTROL,
    );
    expect(PUBLIC_CACHE_CONTROL).toBe('public, max-age=60');
  });

  it('does not set the header on errors', async () => {
    const response = { headersSent: false, setHeader: vi.fn() };
    await expect(
      lastValueFrom(
        interceptor.intercept(ctx(response), {
          handle: () => throwError(() => new Error('nope')),
        } as CallHandler),
      ),
    ).rejects.toThrow('nope');
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('does not touch the header once the headers were sent', async () => {
    const response = { headersSent: true, setHeader: vi.fn() };
    await lastValueFrom(
      interceptor.intercept(ctx(response), {
        handle: () => of(1),
      } as CallHandler),
    );
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
