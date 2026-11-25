// Scripted stand-in for the Claude API (MODEL_CLIENT), for unit and e2e tests.
// No network: each stream() call consumes the next scripted turn.
import type {
  ModelClient,
  ModelMessage,
  ModelRequest,
  ModelStream,
} from '../../src/modules/assistant/model-client.js';

export interface ScriptedTurn {
  /** Text deltas, streamed in order. */
  text?: string[];
  toolUses?: { id: string; name: string; input: unknown }[];
  stopReason?: ModelMessage['stop_reason'];
  model?: string;
  usage?: Partial<{
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  }>;
  /** Extra content blocks placed first (e.g. a fallback marker). */
  prefix?: unknown[];
  /** finalMessage() rejects with this. */
  error?: unknown;
  /** Waits for the abort signal before resolving (client disconnect tests). */
  hang?: boolean;
}

class FakeStream implements ModelStream {
  private readonly listeners: ((delta: string) => void)[] = [];

  constructor(
    private readonly turn: ScriptedTurn,
    private readonly signal?: AbortSignal,
  ) {}

  on(_event: 'text', listener: (delta: string) => void): this {
    this.listeners.push(listener);
    return this;
  }

  abort(): void {}

  async finalMessage(): Promise<ModelMessage> {
    await Promise.resolve();
    for (const delta of this.turn.text ?? []) {
      for (const listener of this.listeners) listener(delta);
    }
    if (this.turn.hang) {
      await new Promise((_resolve, reject) => {
        if (this.signal?.aborted) reject(new Error('aborted'));
        this.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (this.turn.error) throw this.turn.error;
    const toolUses = this.turn.toolUses ?? [];
    const text = (this.turn.text ?? []).join('');
    return {
      id: `msg_${Math.random().toString(36).slice(2)}`,
      type: 'message',
      role: 'assistant',
      model: this.turn.model ?? 'claude-sonnet-5-5',
      content: [
        ...(this.turn.prefix ?? []),
        ...(text ? [{ type: 'text', text, citations: null }] : []),
        ...toolUses.map((t) => ({ type: 'tool_use', ...t })),
      ],
      stop_reason:
        this.turn.stopReason ?? (toolUses.length > 0 ? 'tool_use' : 'end_turn'),
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        ...this.turn.usage,
      },
    } as unknown as ModelMessage;
  }
}

export class FakeModelClient implements ModelClient {
  configured = true;
  /** Snapshot of every request sent, in order. */
  readonly requests: ModelRequest[] = [];
  private readonly turns: ScriptedTurn[] = [];

  script(...turns: ScriptedTurn[]): this {
    this.turns.push(...turns);
    return this;
  }

  reset(): void {
    this.turns.length = 0;
    this.requests.length = 0;
    this.configured = true;
  }

  stream(request: ModelRequest, options?: { signal?: AbortSignal }): ModelStream {
    this.requests.push(structuredClone(request));
    const turn = this.turns.shift() ?? { text: ['(sin guion)'] };
    return new FakeStream(turn, options?.signal);
  }
}
