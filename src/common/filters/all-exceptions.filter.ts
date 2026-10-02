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
