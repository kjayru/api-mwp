import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';

/**
 * Seam between the assistant and the Claude API so tests can inject a fake
 * through Nest DI. The real implementation is the official SDK's streaming
 * helper (`client.beta.messages.stream`); the beta namespace is needed for
 * server-side refusal fallbacks.
 */
export const MODEL_CLIENT = Symbol('MODEL_CLIENT');

export type ModelRequest = BetaMessageStreamParams;
export type ModelMessage = Anthropic.Beta.Messages.BetaMessage;

/** The part of the SDK's BetaMessageStream the assistant uses. */
export interface ModelStream {
  on(event: 'text', listener: (delta: string) => void): unknown;
  /** Resolves with the complete message; rejects on API, network or abort errors. */
  finalMessage(): Promise<ModelMessage>;
  abort(): void;
}

export interface ModelClient {
  /** False when ANTHROPIC_API_KEY is not set. */
  readonly configured: boolean;
  stream(request: ModelRequest, options?: { signal?: AbortSignal }): ModelStream;
}

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic | null;

  constructor(apiKey: string | undefined) {
    // maxRetries: the SDK retries 408/409/429/5xx and connection errors.
    this.client = apiKey
      ? new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 })
      : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  stream(request: ModelRequest, options?: { signal?: AbortSignal }): ModelStream {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    return this.client.beta.messages.stream(request, { signal: options?.signal });
  }
}
