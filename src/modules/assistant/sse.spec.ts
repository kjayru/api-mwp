import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { formatSseEvent, SSE_KEEPALIVE_COMMENT, SseStream } from './sse.js';

class FakeResponse extends EventEmitter {
  statusCode = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  writableEnded = false;
  destroyed = false;
  flushed = false;
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  flushHeaders() {
    this.flushed = true;
  }
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
  }
}

describe('SSE', () => {
  it('formats one event with a single data line of JSON', () => {
    expect(formatSseEvent('delta', { text: 'Hola\n\nmundo' })).toBe(
      'event: delta\ndata: {"text":"Hola\\n\\nmundo"}\n\n',
    );
    expect(formatSseEvent('sources', [])).toBe('event: sources\ndata: []\n\n');
    expect(() => formatSseEvent('bad\nevent', {})).toThrow();
  });

  it('opens the stream with the SSE headers, sends keep-alives and closes once', () => {
    vi.useFakeTimers();
    const res = new FakeResponse();
    const sse = new SseStream(res as unknown as Response, 15_000);

    sse.open();
    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    expect(res.flushed).toBe(true);

    sse.send('conversation', { conversationId: 'c1' });
    vi.advanceTimersByTime(15_000);
    expect(res.chunks).toEqual([
      'event: conversation\ndata: {"conversationId":"c1"}\n\n',
      SSE_KEEPALIVE_COMMENT,
    ]);

    sse.close();
    sse.send('delta', { text: 'late' });
    vi.advanceTimersByTime(30_000);
    expect(res.chunks).toHaveLength(2);
    expect(res.writableEnded).toBe(true);
    vi.useRealTimers();
  });
});
