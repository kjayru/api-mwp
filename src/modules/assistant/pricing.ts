/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Cache write, 5-minute TTL (1.25 x input). */
  cacheWrite: number;
  cacheRead: number;
}

/**
 * Claude prices by model id. Update this table when prices change; a model
 * missing from it is reported as unpriced (tokens counted, cost not).
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-sonnet-5-5': {
    input: 2.0,
    output: 10.0,
    cacheWrite: 2.5,
    cacheRead: 0.1,
  },
};

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/**
 * Estimated cost in USD, or null when the model has no price. The API's
 * `input_tokens` excludes cached tokens, so the four buckets are disjoint.
 */
export function estimateCostUsd(
  model: string,
  tokens: TokenCounts,
  prices: Readonly<Record<string, ModelPrice>> = MODEL_PRICES,
): number | null {
  const price = prices[model];
  if (!price) return null;
  return (
    (tokens.inputTokens * price.input +
      tokens.cacheCreationInputTokens * price.cacheWrite +
      tokens.cacheReadInputTokens * price.cacheRead +
      tokens.outputTokens * price.output) /
    1_000_000
  );
}
