import { Inject, Injectable, Logger } from '@nestjs/common';

/** Cache tags understood by front-mwp's revalidation route (see docs/API.md). */
export const RevalidationTag = {
  cases: 'cases',
  technologies: 'technologies',
  services: 'services',
  stats: 'stats',
  case: (slug: string) => `case:${slug}`,
  blog: 'blog',
  post: (slug: string) => `post:${slug}`,
} as const;

export interface RevalidationOptions {
  /** POST target; when undefined the webhook is disabled. */
  url?: string;
  secret?: string;
  timeoutMs: number;
}

export const REVALIDATION_OPTIONS = Symbol('REVALIDATION_OPTIONS');
export const REVALIDATE_SECRET_HEADER = 'x-revalidate-secret';

/**
 * Tells front-mwp which cached content changed after an admin mutation:
 * `POST <FRONT_REVALIDATE_URL>` with `{ tags }`. Fire-and-forget: the returned
 * promise never rejects and callers do not await it, so a slow or broken front
 * never fails (or delays) the admin request.
 */
@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name);

  constructor(
    @Inject(REVALIDATION_OPTIONS)
    private readonly options: RevalidationOptions,
  ) {}

  revalidate(tags: Iterable<string>): Promise<void> {
    const unique = [...new Set(tags)];
    const { url, secret, timeoutMs } = this.options;
    if (!url || unique.length === 0) {
      return Promise.resolve();
    }

    return fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [REVALIDATE_SECRET_HEADER]: secret ?? '',
      },
      body: JSON.stringify({ tags: unique }),
      signal: AbortSignal.timeout(timeoutMs),
    })
      .then(async (response) => {
        // Drain the body so the connection can be reused.
        await response.arrayBuffer().catch(() => undefined);
        if (!response.ok) {
          this.logger.warn(
            `Front revalidation answered ${response.status} for tags [${unique.join(', ')}]`,
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Front revalidation failed for tags [${unique.join(', ')}]: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }
}
