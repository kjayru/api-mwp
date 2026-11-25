import { Logger } from '@nestjs/common';
import {
  EMBEDDING_DIMENSION,
  type EmbeddingInputType,
  type EmbeddingsProvider,
  EmbeddingsNotConfiguredError,
} from './embeddings-provider.js';

export const VOYAGE_EMBEDDINGS_URL = 'https://api.voyageai.com/v1/embeddings';
/** Texts per request (Voyage allows 1000; small batches keep requests light). */
export const VOYAGE_BATCH_SIZE = 128;
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

interface VoyageResponse {
  data?: { embedding?: unknown; index?: number }[];
  usage?: { total_tokens?: number };
}

export interface VoyageOptions {
  apiKey?: string;
  model: string;
  /** Injected in unit tests. */
  fetchFn?: typeof fetch;
  /** Delay before retry `attempt` (1-based) after `status`, in ms. */
  backoffMs?: (attempt: number, status: number) => number;
}

/**
 * Voyage AI embeddings over the documented REST endpoint
 * (POST /v1/embeddings with model, input, input_type, output_dimension).
 * Retries 429 and 5xx twice; any other failure throws.
 */
export class VoyageEmbeddingsProvider implements EmbeddingsProvider {
  private readonly logger = new Logger(VoyageEmbeddingsProvider.name);
  private readonly fetchFn: typeof fetch;
  private readonly backoffMs: (attempt: number, status: number) => number;
  readonly model: string;

  constructor(private readonly options: VoyageOptions) {
    this.model = options.model;
    this.fetchFn = options.fetchFn ?? fetch;
    // 429: accounts without a payment method get 3 requests per minute, so
    // wait long enough for the window to move (unless Retry-After says otherwise).
    this.backoffMs =
      options.backoffMs ??
      ((attempt, status) => (status === 429 ? 10_000 : 1000) * attempt);
  }

  get configured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async embed(
    texts: string[],
    inputType: EmbeddingInputType,
  ): Promise<number[][]> {
    if (!this.configured) throw new EmbeddingsNotConfiguredError();
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += VOYAGE_BATCH_SIZE) {
      const batch = texts.slice(i, i + VOYAGE_BATCH_SIZE);
      vectors.push(...(await this.embedBatch(batch, inputType)));
    }
    return vectors;
  }

  private async embedBatch(
    input: string[],
    inputType: EmbeddingInputType,
  ): Promise<number[][]> {
    const body = JSON.stringify({
      model: this.model,
      input,
      input_type: inputType,
      output_dimension: EMBEDDING_DIMENSION,
      truncation: true,
    });
    for (let attempt = 1; ; attempt++) {
      const response = await this.fetchFn(VOYAGE_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) {
        return this.parse((await response.json()) as VoyageResponse, input);
      }
      const retryable = response.status === 429 || response.status >= 500;
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw new Error(`Voyage AI answered ${response.status}: ${detail}`);
      }
      this.logger.warn(
        `Voyage AI answered ${response.status}; retrying (${attempt}/${MAX_ATTEMPTS - 1})`,
      );
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 60) * 1000
          : this.backoffMs(attempt, response.status);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  private parse(body: VoyageResponse, input: string[]): number[][] {
    const data = body.data ?? [];
    if (data.length !== input.length) {
      throw new Error(
        `Voyage AI returned ${data.length} embeddings for ${input.length} texts`,
      );
    }
    const vectors: number[][] = Array.from({ length: input.length }, () => []);
    data.forEach((item, position) => {
      const index = item.index ?? position;
      const embedding = item.embedding;
      if (
        !Array.isArray(embedding) ||
        embedding.length !== EMBEDDING_DIMENSION ||
        !embedding.every((value) => typeof value === 'number')
      ) {
        throw new Error(
          `Voyage AI returned an embedding that is not ${EMBEDDING_DIMENSION} numbers (model ${this.model})`,
        );
      }
      vectors[index] = embedding as number[];
    });
    return vectors;
  }
}
