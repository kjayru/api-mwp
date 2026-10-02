import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
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

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
        error = exception.name;
      } else {
        const body = response as {
          message?: string | string[];
          error?: string;
        };
        message = body.message ?? exception.message;
        error = body.error ?? exception.name;
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
    };
    httpAdapter.reply(ctx.getResponse(), body, statusCode);
  }
}
