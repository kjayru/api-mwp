import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { STATUS_CODES } from 'node:http';

export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  /** Machine-readable extra data, only on some errors (e.g. 422 on publish). */
  details?: unknown;
}

/**
 * A 4xx `http-errors` error (thrown by Express middleware such as body-parser)
 * whose message is meant for the client (`expose: true`).
 */
function isExposedClientError(
  exception: unknown,
): exception is { status: number; message: string } {
  if (typeof exception !== 'object' || exception === null) return false;
  const { status, expose, message } = exception as {
    status?: unknown;
    expose?: unknown;
    message?: unknown;
  };
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    expose === true &&
    typeof message === 'string'
  );
}

/** Gives every error the same response shape and hides internals of unexpected ones. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string | string[] = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        // e.g. ThrottlerException: use the standard reason phrase ("Too Many Requests").
        message = response;
        error = STATUS_CODES[statusCode] ?? exception.name;
      } else {
        const body = response as {
          message?: string | string[];
          error?: string;
          details?: unknown;
        };
        message = body.message ?? exception.message;
        error = body.error ?? exception.name;
        details = body.details;
      }
    } else if (isExposedClientError(exception)) {
      // Express body-parser errors that Nest does not map (it only maps invalid
      // JSON to 400), e.g. 413 for a body above the JSON limit.
      statusCode = exception.status;
      error = STATUS_CODES[statusCode] ?? 'Error';
      message =
        statusCode === HttpStatus.PAYLOAD_TOO_LARGE
          ? 'El cuerpo de la petición es demasiado grande'
          : exception.message;
    } else {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponse = {
      statusCode,
      error,
      message,
      path: httpAdapter.getRequestUrl(ctx.getRequest()) as string,
      timestamp: new Date().toISOString(),
      ...(details === undefined ? {} : { details }),
    };
    httpAdapter.reply(ctx.getResponse(), body, statusCode);
  }
}
