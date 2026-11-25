import Anthropic from '@anthropic-ai/sdk';
import { FakeModelClient } from '../../../test/utils/fake-model-client.js';
import type { AssistantSettingsView } from '../assistant-settings/assistant-settings.service.js';
import type { KnowledgeHit } from '../knowledge/knowledge-search.service.js';
import {
  AssistantEngineService,
  echoableContent,
  friendlyMessage,
  MAX_TOOL_ROUNDS,
} from './assistant-engine.service.js';
import type {
  AssistantToolsService,
  ToolExecution,
} from './tools/assistant-tools.service.js';

const settings: AssistantSettingsView = {
  model: 'claude-sonnet-5-5',
  effort: 'low',
  instructions: 'Eres el asistente.',
  enabledTools: ['buscar_casos', 'crear_lead', 'agendar_reunion'],
  maxMessagesPerSession: 20,
  updatedAt: new Date(),
};

function hit(sourceKey: string, title: string, score = 0.7): KnowledgeHit {
  return {
    sourceType: 'CASE',
    sourceId: `id-${title}`,
    locale: 'ES',
    sourceKey,
    title,
    url: `/es/casos/${title.toLowerCase()}`,
    content: `Contenido de ${title}`,
    similarity: score,
    score,
  };
}

function searchResult(id: string, hits: KnowledgeHit[]): ToolExecution {
  return {
    content: JSON.stringify({ resultados: hits.map((h) => h.sourceKey) }),
    isError: false,
    hits,
    record: { id, name: 'buscar_casos', input: {}, status: 'completed', summary: {} },
  };
}

describe('AssistantEngineService', () => {
  const model = new FakeModelClient();
  const tools = { execute: vi.fn() };
  const engine = new AssistantEngineService(
    model,
    tools as unknown as AssistantToolsService,
  );
  const input = (overrides = {}) => ({
    settings,
    tools: settings.enabledTools,
    messages: [{ role: 'user' as const, content: '<contexto>…</contexto>\n\n¿Contadores?' }],
    context: { conversationId: 'conv-1', locale: 'ES' as const, caseSlug: null },
    ...overrides,
  });

  beforeEach(() => {
    model.reset();
    tools.execute.mockReset();
  });

  it('runs buscar_casos, streams the answer without markers and reports the cited sources', async () => {
    const contaflow = hit('caso:contaflow-ia#0', 'ContaFlow');
    const otro = hit('caso:otro#0', 'Otro', 0.5);
    tools.execute.mockResolvedValue(searchResult('tu_1', [contaflow, otro]));
    model.script(
      {
        text: ['Déjame revisar.'],
        toolUses: [{ id: 'tu_1', name: 'buscar_casos', input: { query: 'contadores' } }],
        usage: { input_tokens: 900, output_tokens: 40, cache_creation_input_tokens: 1500 },
      },
      {
        text: ['Sí, hicimos ', 'ContaFlow [caso:contaf', 'low-ia#0].'],
        usage: { input_tokens: 300, output_tokens: 60, cache_read_input_tokens: 1500 },
      },
    );
    const deltas: string[] = [];
    const toolEvents: unknown[] = [];

    const result = await engine.run(input(), {
      delta: (t) => deltas.push(t),
      tool: (e) => toolEvents.push(e),
    });

    expect(deltas.join('')).toBe('Déjame revisar.\n\nSí, hicimos ContaFlow.');
    expect(result.text).toBe('Déjame revisar.\n\nSí, hicimos ContaFlow.');
    expect(result.sources).toEqual([
      { sourceKey: 'caso:contaflow-ia#0', title: 'ContaFlow', url: '/es/casos/contaflow' },
    ]);
    expect(result.unanswered).toBe(false);
    expect(result.stopReason).toBe('end_turn');
    expect(toolEvents).toEqual([
      { name: 'buscar_casos', status: 'started' },
      { name: 'buscar_casos', status: 'completed' },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 100,
      cacheReadInputTokens: 1500,
      cacheCreationInputTokens: 1500,
      requests: 2,
    });

    // Second call: the assistant turn is echoed and the tool result follows.
    const second = model.requests[1];
    expect(second.messages.slice(1)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Déjame revisar.', citations: null },
          { type: 'tool_use', id: 'tu_1', name: 'buscar_casos', input: { query: 'contadores' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: JSON.stringify({ resultados: ['caso:contaflow-ia#0', 'caso:otro#0'] }),
          },
        ],
      },
    ]);
    // The prefix (tools, system) is identical in every call of the turn.
    expect(second.system).toEqual(model.requests[0].system);
    expect(second.tools).toEqual(model.requests[0].tools);
  });

  it('marks the turn unanswered when buscar_casos finds nothing relevant', async () => {
    tools.execute.mockResolvedValue(searchResult('tu_1', []));
    model.script(
      { toolUses: [{ id: 'tu_1', name: 'buscar_casos', input: { query: 'relojes' } }] },
      { text: ['No tengo información sobre eso. ¿Quieres hablar con el equipo?'] },
    );

    const result = await engine.run(input());

    expect(result.unanswered).toBe(true);
    expect(result.sources).toEqual([]);
  });

  it('is not unanswered when a later search of the same turn finds something', async () => {
    tools.execute
      .mockResolvedValueOnce(searchResult('tu_1', []))
      .mockResolvedValueOnce(searchResult('tu_2', [hit('caso:a#0', 'A')]));
    model.script(
      { toolUses: [{ id: 'tu_1', name: 'buscar_casos', input: { query: 'x', tecnologia: 'Rust' } }] },
      { toolUses: [{ id: 'tu_2', name: 'buscar_casos', input: { query: 'x' } }] },
      { text: ['Respuesta sin citar.'] },
    );

    const result = await engine.run(input());

    expect(result.unanswered).toBe(false);
    // Uncited answer: the relevant sources of the search are shown instead.
    expect(result.sources.map((s) => s.sourceKey)).toEqual(['caso:a#0']);
  });

  it('runs parallel tool calls and returns every result in one user message', async () => {
    tools.execute.mockImplementation(async (block: { id: string; name: string }) =>
      block.name === 'crear_lead'
        ? {
            content: '{"error":"email inválido"}',
            isError: true,
            record: { id: block.id, name: block.name, input: {}, status: 'failed', summary: {} },
          }
        : searchResult(block.id, [hit('caso:a#0', 'A')]),
    );
    model.script(
      {
        toolUses: [
          { id: 'tu_1', name: 'buscar_casos', input: { query: 'a' } },
          { id: 'tu_2', name: 'crear_lead', input: {} },
        ],
      },
      { text: ['Listo [caso:a#0].'] },
    );

    const result = await engine.run(input());

    const toolResults = model.requests[1].messages.at(-1);
    expect(toolResults).toEqual({
      role: 'user',
      content: [
        expect.objectContaining({ tool_use_id: 'tu_1' }),
        expect.objectContaining({ tool_use_id: 'tu_2', is_error: true }),
      ],
    });
    expect(result.toolCalls.map((c) => c.status).sort()).toEqual(['completed', 'failed']);
  });

  it('on refusal answers with a friendly message and never runs the tools', async () => {
    model.script({
      text: ['Empiezo a'],
      toolUses: [{ id: 'tu_1', name: 'buscar_casos', input: { query: 'x' } }],
      stopReason: 'refusal',
    });
    const deltas: string[] = [];

    const result = await engine.run(input(), { delta: (t) => deltas.push(t) });

    expect(tools.execute).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('refusal');
    expect(result.text).toBe(friendlyMessage('ES', 'refusal'));
    expect(result.sources).toEqual([]);
    expect(deltas.join('')).toBe(`Empiezo a\n\n${friendlyMessage('ES', 'refusal')}`);
  });

  it('on max_tokens never runs a possibly truncated tool input', async () => {
    model.script({
      toolUses: [{ id: 'tu_1', name: 'crear_lead', input: { nombre: 'An' } }],
      stopReason: 'max_tokens',
    });

    const result = await engine.run(input({ context: { conversationId: 'c', locale: 'EN', caseSlug: null } }));

    expect(tools.execute).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('max_tokens');
    expect(result.text).toBe(friendlyMessage('EN', 'incomplete'));
  });

  it(`stops offering tools after ${MAX_TOOL_ROUNDS} rounds`, async () => {
    tools.execute.mockResolvedValue(searchResult('tu', [hit('caso:a#0', 'A')]));
    const toolTurn = (n: number) => ({
      toolUses: [{ id: `tu_${n}`, name: 'buscar_casos', input: { query: `q${n}` } }],
    });
    model.script(toolTurn(1), toolTurn(2), toolTurn(3), toolTurn(4), { text: ['Final.'] });

    const result = await engine.run(input());

    expect(model.requests).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(model.requests.slice(0, -1).every((r) => r.tool_choice === undefined)).toBe(true);
    expect(model.requests.at(-1)?.tool_choice).toEqual({ type: 'none' });
    expect(result.text).toBe('Final.');
  });

  it('re-issues a call whose streamed tool input was not valid JSON, but rethrows API errors', async () => {
    model.script({ error: new SyntaxError('Unexpected token') }, { text: ['Hola.'] });
    await expect(engine.run(input())).resolves.toMatchObject({ text: 'Hola.' });
    expect(model.requests).toHaveLength(2);

    model.reset();
    const apiError = new Anthropic.APIError(529, undefined, 'Overloaded', new Headers());
    model.script({ error: apiError });
    await expect(engine.run(input())).rejects.toBe(apiError);
  });

  it('returns stopReason "aborted" when the client goes away', async () => {
    const controller = new AbortController();
    model.script({ text: ['Parcial'], hang: true });
    const pending = engine.run(input({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 5);
    const result = await pending;
    expect(result.stopReason).toBe('aborted');
    expect(result.text).toBe('Parcial');
  });
});

describe('echoableContent', () => {
  it('drops the fallback marker and the declined model blocks before it', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: 'Parcial', citations: null },
      { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
      { type: 'thinking', thinking: '', signature: 't' },
      { type: 'tool_use', id: 'tu', name: 'buscar_casos', input: {} },
    ] as unknown as Parameters<typeof echoableContent>[0];
    expect(echoableContent(content).map((b) => b.type)).toEqual([
      'text',
      'thinking',
      'tool_use',
    ]);
  });
});
