import { BadRequestException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import {
  RECAPTCHA_FAILED_MESSAGE,
  RECAPTCHA_VERIFY_URL,
  RecaptchaService,
} from './recaptcha.service.js';

const SECRET = 'sk-super-secret-value';
const TOKEN = 'token-from-the-browser';

function makeService(values: Record<string, unknown>): RecaptchaService {
  const config = { get: (key: string) => values[key] };
  return new RecaptchaService(config as unknown as ConfigService<Env, true>);
}

function google(body: unknown, init: { status?: number } = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
  });
}

async function reason(promise: Promise<void>): Promise<unknown> {
  const error = (await promise.catch((e: unknown) => e)) as BadRequestException;
  expect(error).toBeInstanceOf(BadRequestException);
  expect(error.getStatus()).toBe(400);
  const body = error.getResponse() as {
    message: string;
    details: { reason: string };
  };
  expect(body.message).toBe(RECAPTCHA_FAILED_MESSAGE);
  return body.details.reason;
}

describe('RecaptchaService', () => {
  const enabled = makeService({
    RECAPTCHA_SECRET_KEY: SECRET,
    RECAPTCHA_MIN_SCORE: 0.5,
  });
  let fetchMock: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const logged = () => JSON.stringify(warn.mock.calls);

  it('does nothing without a secret key (token ignored, no Google call)', async () => {
    const service = makeService({ RECAPTCHA_SECRET_KEY: undefined });
    expect(service.enabled).toBe(false);
    await expect(service.verify(undefined, '1.2.3.4')).resolves.toBeUndefined();
    await expect(service.verify(TOKEN, '1.2.3.4')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing token without calling Google', async () => {
    expect(await reason(enabled.verify(undefined, '1.2.3.4'))).toBe(
      'recaptcha_failed',
    );
    expect(await reason(enabled.verify('', '1.2.3.4'))).toBe(
      'recaptcha_failed',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a good score and posts the form-encoded siteverify request', async () => {
    fetchMock.mockResolvedValue(
      google({
        success: true,
        score: 0.9,
        action: 'contact',
        hostname: 'miwebprofesional.com',
      }),
    );
    await expect(enabled.verify(TOKEN, '203.0.113.9')).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RECAPTCHA_VERIFY_URL);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      secret: SECRET,
      response: TOKEN,
      remoteip: '203.0.113.9',
    });
  });

  it('accepts a score equal to the minimum and uses 0.5 by default', async () => {
    const service = makeService({ RECAPTCHA_SECRET_KEY: SECRET });
    fetchMock.mockResolvedValue(
      google({ success: true, score: 0.5, action: 'contact' }),
    );
    await expect(service.verify(TOKEN)).resolves.toBeUndefined();
    fetchMock.mockResolvedValue(
      google({ success: true, score: 0.49, action: 'contact' }),
    );
    await reason(service.verify(TOKEN));
  });

  it('rejects a low score', async () => {
    fetchMock.mockResolvedValue(
      google({ success: true, score: 0.1, action: 'contact' }),
    );
    expect(await reason(enabled.verify(TOKEN))).toBe('recaptcha_failed');
  });

  it('rejects another action', async () => {
    fetchMock.mockResolvedValue(
      google({ success: true, score: 0.9, action: 'login' }),
    );
    await reason(enabled.verify(TOKEN));
  });

  it('rejects success=false and logs the error codes without secret or token', async () => {
    fetchMock.mockResolvedValue(
      google({
        success: false,
        'error-codes': ['invalid-input-response', 'timeout-or-duplicate'],
        hostname: 'miwebprofesional.com',
      }),
    );
    await reason(enabled.verify(TOKEN));
    expect(logged()).toContain('invalid-input-response');
    expect(logged()).toContain('miwebprofesional.com');
    expect(logged()).not.toContain(SECRET);
    expect(logged()).not.toContain(TOKEN);
  });

  it.each([
    ['network error', () => Promise.reject(new TypeError(`fetch ${SECRET}`))],
    [
      'timeout',
      () =>
        Promise.reject(new DOMException('The operation timed out', 'TimeoutError')),
    ],
    ['non-2xx', () => Promise.resolve(google('oops', { status: 502 }))],
    ['invalid JSON', () => Promise.resolve(google('<html>'))],
  ])('fails open on %s', async (_name, respond) => {
    fetchMock.mockImplementation(respond);
    await expect(enabled.verify(TOKEN, '1.2.3.4')).resolves.toBeUndefined();
    expect(logged()).toContain(
      'reCAPTCHA unavailable, lead accepted without verification',
    );
    expect(logged()).not.toContain(SECRET);
    expect(logged()).not.toContain(TOKEN);
  });
});
