import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function setup() {
  const reply = vi.fn();
  const httpAdapter = {
    reply,
    getRequestUrl: vi.fn().mockReturnValue('/api/v1/things'),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({ res: true }),
    }),
  } as unknown as ArgumentsHost;
  const filter = new AllExceptionsFilter({
    httpAdapter,
  } as unknown as HttpAdapterHost);
  const run = (e: unknown) => {
    filter.catch(e, host);
    const [, body, status] = reply.mock.calls[0] as [unknown, any, number];
    return { body, status };
  };
  return { run, reply };
}

describe('AllExceptionsFilter', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps the status, error and message of an HttpException', () => {
    const { run } = setup();
    const { body, status } = run(new NotFoundException('No existe'));
    expect(status).toBe(404);
    expect(body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'No existe',
      path: '/api/v1/things',
    });
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    expect(body).not.toHaveProperty('details');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('passes validation message arrays through', () => {
    const { run } = setup();
    const { body, status } = run(
      new BadRequestException(['a must be a string', 'b is required']),
    );
    expect(status).toBe(400);
    expect(body.message).toEqual(['a must be a string', 'b is required']);
  });

  it('includes details when the exception carries them', () => {
    const { run } = setup();
    const { body, status } = run(
      new HttpException(
        { message: 'Falta contenido', details: { missing: ['title'] } },
        422,
      ),
    );
    expect(status).toBe(422);
    expect(body.details).toEqual({ missing: ['title'] });
    expect(body.message).toBe('Falta contenido');
  });

  it('falls back to exception.message / name when the body has none', () => {
    const { run } = setup();
    const { body } = run(new HttpException({}, 409));
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe('HttpException');
    expect(typeof body.message).toBe('string');
  });

  it('uses the reason phrase when the response is a plain string', () => {
    const { run } = setup();
    const { body, status } = run(new HttpException('Slow down', 429));
    expect(status).toBe(429);
    expect(body).toMatchObject({
      error: 'Too Many Requests',
      message: 'Slow down',
    });
  });

  it('hides the internals of unexpected errors and logs them', () => {
    const { run } = setup();
    const { body, status } = run(
      new Error('connection to db-prod:5432 failed'),
    );
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
    expect(JSON.stringify(body)).not.toContain('db-prod');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain('db-prod');
  });

  it('handles non-Error throwables', () => {
    const { run } = setup();
    const { body, status } = run('boom');
    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(logSpy).toHaveBeenCalledWith('boom');
  });

  it('maps a 413 body-parser error to a Spanish message', () => {
    const { run } = setup();
    const { body, status } = run({
      status: 413,
      expose: true,
      message: 'request entity too large',
    });
    expect(status).toBe(413);
    expect(body.error).toBe('Payload Too Large');
    expect(body.message).toBe('El cuerpo de la petición es demasiado grande');
  });

  it('exposes the message of other exposed 4xx client errors', () => {
    const { run } = setup();
    const { body, status } = run({
      status: 415,
      expose: true,
      message: 'unsupported',
    });
    expect(status).toBe(415);
    expect(body.message).toBe('unsupported');
  });

  it.each([
    { status: 500, expose: true, message: 'x' },
    { status: 400, expose: false, message: 'x' },
    { status: '400', expose: true, message: 'x' },
    { status: 400, expose: true, message: 5 },
  ])('does not expose %j', (e) => {
    const { run } = setup();
    const { body, status } = run(e);
    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
  });
});
