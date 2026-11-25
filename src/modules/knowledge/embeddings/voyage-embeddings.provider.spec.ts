import { EMBEDDING_DIMENSION, EmbeddingsNotConfiguredError, toVectorLiteral } from './embeddings-provider.js';
import {
  VOYAGE_BATCH_SIZE,
  VOYAGE_EMBEDDINGS_URL,
  VoyageEmbeddingsProvider,
} from './voyage-embeddings.provider.js';

const vector = (value: number) =>
  Array.from({ length: EMBEDDING_DIMENSION }, () => value);

function ok(count: number, value = 0.5): Response {
  return new Response(
    JSON.stringify({
      data: Array.from({ length: count }, (_, index) => ({
        embedding: vector(value),
        index,
      })),
      usage: { total_tokens: 10 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('VoyageEmbeddingsProvider', () => {
  it('posts model, input_type and the dimension, with the key as a bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(2));
    const provider = new VoyageEmbeddingsProvider({
      apiKey: 'key',
      model: 'voyage-3.5',
      fetchFn,
    });

    const vectors = await provider.embed(['uno', 'dos'], 'document');

    expect(vectors).toHaveLength(2);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(VOYAGE_EMBEDDINGS_URL);
    expect(init.headers.authorization).toBe('Bearer key');
    expect(JSON.parse(init.body)).toEqual({
      model: 'voyage-3.5',
      input: ['uno', 'dos'],
      input_type: 'document',
      output_dimension: EMBEDDING_DIMENSION,
      truncation: true,
    });
  });

  it('batches long inputs', async () => {
    const fetchFn = vi
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) =>
        ok((JSON.parse(String(init.body)).input as string[]).length),
      );
    const provider = new VoyageEmbeddingsProvider({ apiKey: 'k', model: 'm', fetchFn });

    const texts = Array.from({ length: VOYAGE_BATCH_SIZE + 3 }, (_, i) => `t${i}`);
    const vectors = await provider.embed(texts, 'query');

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(texts.length);
  });

  it('retries 429 and 5xx, then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('oops', { status: 503 }))
      .mockResolvedValueOnce(ok(1));
    const backoffMs = vi.fn().mockReturnValue(0);
    const provider = new VoyageEmbeddingsProvider({
      apiKey: 'k',
      model: 'm',
      fetchFn,
      backoffMs,
    });

    await expect(provider.embed(['x'], 'query')).resolves.toHaveLength(1);
    expect(backoffMs.mock.calls).toEqual([
      [1, 429],
      [2, 503],
    ]);
  });

  it('does not retry other errors and fails on a wrong dimension', async () => {
    const bad = new VoyageEmbeddingsProvider({
      apiKey: 'k',
      model: 'm',
      fetchFn: vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })),
    });
    await expect(bad.embed(['x'], 'query')).rejects.toThrow(/401/);

    const short = new VoyageEmbeddingsProvider({
      apiKey: 'k',
      model: 'm',
      fetchFn: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3], index: 0 }] })),
      ),
    });
    await expect(short.embed(['x'], 'query')).rejects.toThrow(/1024/);
  });

  it('throws when the API key is missing', async () => {
    const provider = new VoyageEmbeddingsProvider({ model: 'm' });
    expect(provider.configured).toBe(false);
    await expect(provider.embed(['x'], 'query')).rejects.toBeInstanceOf(
      EmbeddingsNotConfiguredError,
    );
  });
});

describe('toVectorLiteral', () => {
  it('formats a pgvector literal and validates the vector', () => {
    expect(toVectorLiteral(vector(0)).startsWith('[0,0,')).toBe(true);
    expect(() => toVectorLiteral([1, 2])).toThrow(/1024/);
    expect(() => toVectorLiteral(vector(Number.NaN))).toThrow(/non-finite/);
  });
});
