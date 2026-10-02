import { ValidateIf } from 'class-validator';

/**
 * Like `@IsOptional()` but only for `undefined`: an explicit `null` is still
 * validated (and rejected by `@IsString()` etc.). Use it on PATCH fields that
 * may be omitted but not cleared.
 */
export const IsOptionalNonNull = () =>
  ValidateIf((_object: object, value: unknown) => value !== undefined);
