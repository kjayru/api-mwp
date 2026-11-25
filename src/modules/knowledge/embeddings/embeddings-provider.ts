/**
 * Text embeddings for the knowledge base. The implementation is Voyage AI
 * (voyage-embeddings.provider.ts); tests inject a fake through Nest DI.
 */
export const EMBEDDINGS_PROVIDER = Symbol('EMBEDDINGS_PROVIDER');

/** Dimension of knowledge_chunks.embedding (vector(1024) in the migration). */
export const EMBEDDING_DIMENSION = 1024;

/**
 * Voyage distinguishes what is stored ("document") from what is searched
 * ("query"); using the right one improves retrieval.
 */
export type EmbeddingInputType = 'document' | 'query';

export interface EmbeddingsProvider {
  /** Model id stored with each chunk (a change of model means a reindex). */
  readonly model: string;
  /** False when the API key is missing: embed() then throws. */
  readonly configured: boolean;
  /** One unit-length vector of EMBEDDING_DIMENSION numbers per text, in order. */
  embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]>;
}

export class EmbeddingsNotConfiguredError extends Error {
  constructor() {
    super('VOYAGE_API_KEY is not set: the knowledge base cannot be embedded');
    this.name = 'EmbeddingsNotConfiguredError';
  }
}

/** pgvector literal ("[0.1,0.2,...]") for a `${...}::vector` SQL parameter. */
export function toVectorLiteral(vector: number[]): string {
  if (vector.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Expected an embedding of ${EMBEDDING_DIMENSION} dimensions, got ${vector.length}`,
    );
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Error('Embedding contains a non-finite value');
    }
  }
  return `[${vector.join(',')}]`;
}
