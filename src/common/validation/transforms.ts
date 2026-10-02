import { Transform } from 'class-transformer';

/** Trims string input; leaves anything else untouched for the validators to reject. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/** Query-string boolean: "true" / "false" -> true / false. */
export const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });

/** Lowercases string input (e.g. enum-like query parameters). */
export const ToLowerCase = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  );

/** URL validator options shared by every image/cover URL field. */
export const HTTP_URL_OPTIONS = {
  protocols: ['http', 'https'],
  require_protocol: true,
  require_tld: false,
};
export const URL_MAX_LENGTH = 2048;
