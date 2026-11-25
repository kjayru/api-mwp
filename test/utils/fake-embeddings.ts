// Deterministic stand-in for Voyage (EMBEDDINGS_PROVIDER) in e2e tests: a
// bag-of-words vector hashed into 1024 dimensions and normalised, so texts
// that share words are similar and unrelated texts score ~0. No network.
import { EMBEDDING_DIMENSION } from '../../src/modules/knowledge/embeddings/embeddings-provider.js';
import type {
  EmbeddingInputType,
  EmbeddingsProvider,
} from '../../src/modules/knowledge/embeddings/embeddings-provider.js';

function hash(word: string): number {
  let h = 2166136261;
  for (const char of word) {
    h ^= char.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % EMBEDDING_DIMENSION;
}

export function fakeEmbedding(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0);
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);
  for (const word of words) vector[hash(word)] += 1;
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  // An empty text gets a fixed unit vector (never matches real words much).
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((v) => v / norm);
}

export class FakeEmbeddingsProvider implements EmbeddingsProvider {
  readonly model = 'fake-embeddings';
  configured = true;
  readonly calls: { texts: string[]; inputType: EmbeddingInputType }[] = [];

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    this.calls.push({ texts, inputType });
    return texts.map(fakeEmbedding);
  }
}
