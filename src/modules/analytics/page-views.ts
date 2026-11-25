// Pure rules of POST /track (docs/API.md 11.3).
import type { Locale } from '../../generated/prisma/enums.js';

export const MAX_TRACKED_PATH_LENGTH = 200;
/** Longer raw input is not even parsed. */
const MAX_RAW_PATH_LENGTH = 2048;

export const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|axios|node-fetch|go-http/i;

/** True for an empty User-Agent or one that looks like a bot. */
export function isBotUserAgent(userAgent: string | undefined): boolean {
  if (!userAgent || userAgent.trim() === '') return true;
  return BOT_USER_AGENT.test(userAgent);
}

/**
 * Path as counted: without query and hash, without trailing "/", lowercase.
 * Null when the view must be ignored (not under /es or /en, an /api/ path,
 * whitespace or control characters, or longer than 200 characters).
 */
export function normalizeTrackedPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_PATH_LENGTH) return null;
  let path = raw.split('#')[0].split('?')[0].toLowerCase();
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(path)) return null;
  path = path.replace(/\/+$/, '');
  if (!/^\/(es|en)(\/|$)/.test(path)) return null;
  if (path.includes('/api/')) return null;
  if (path.length > MAX_TRACKED_PATH_LENGTH) return null;
  return path;
}

/** Body locale ("es" | "en"), which must match the path prefix. */
export function trackedLocale(raw: unknown, path: string): Locale | null {
  if (raw !== 'es' && raw !== 'en') return null;
  if (path.slice(1, 3) !== raw) return null;
  return raw === 'es' ? 'ES' : 'EN';
}
