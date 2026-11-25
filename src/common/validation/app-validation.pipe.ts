import {
  BadRequestException,
  HttpException,
  ValidationPipe,
} from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/** DTO class -> depth of the reported field paths. */
const REPORTING_DTOS = new WeakMap<object, number>();

/**
 * Class decorator: validation 400s of this DTO also carry
 * `details: { fields: [...] }`, the properties that failed, so a form can
 * highlight them. Nested errors are reported as dotted paths cut at `depth`
 * levels: with depth 2, `businessHours.mon.0.start` is reported as
 * `businessHours.mon` (docs/API.md 11.1 and 11.5).
 */
export const ReportInvalidFields =
  (options: { depth?: number } = {}): ClassDecorator =>
  (target) => {
    REPORTING_DTOS.set(target, Math.max(1, options.depth ?? 1));
  };

/** Dotted paths of the failed validations, cut at `depth` levels, without repeats. */
export function invalidFields(errors: ValidationError[], depth = 1): string[] {
  const fields = new Set<string>();
  const visit = (error: ValidationError, path: string[]) => {
    const current = [...path, error.property];
    if (current.length >= depth || !error.children?.length) {
      fields.add(current.slice(0, depth).join('.'));
      return;
    }
    if (error.constraints) fields.add(current.join('.'));
    for (const child of error.children) visit(child, current);
  };
  for (const error of errors) visit(error, []);
  return [...fields];
}

/**
 * The global ValidationPipe (setup-app.ts). Same messages as Nest's (a
 * Spanish `string[]`), plus `details.fields` for DTOs marked with
 * @ReportInvalidFields().
 */
export class AppValidationPipe extends ValidationPipe {
  createExceptionFactory() {
    const base = super.createExceptionFactory();
    return (errors: ValidationError[] = []): unknown => {
      const exception = base(errors);
      const target = errors[0]?.target?.constructor;
      const depth = target ? REPORTING_DTOS.get(target) : undefined;
      if (depth === undefined) return exception;
      const response =
        exception instanceof HttpException ? exception.getResponse() : {};
      const message =
        typeof response === 'object' && response !== null
          ? (response as { message?: unknown }).message
          : response;
      return new BadRequestException({
        message,
        error: 'Bad Request',
        details: { fields: invalidFields(errors, depth) },
      });
    };
  }
}
