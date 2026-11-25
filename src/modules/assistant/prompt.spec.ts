import { toModelMessages } from './assistant.service.js';
import {
  buildModelRequest,
  buildSystemPrompt,
  buildTurnContext,
  FIXED_RULES,
  SERVER_SIDE_FALLBACK_BETA,
} from './prompt.js';
import { toolsFor } from './tools/tool-definitions.js';

describe('buildModelRequest', () => {
  const messages = [{ role: 'user' as const, content: 'Hola' }];
  const tools = toolsFor(['buscar_casos', 'crear_lead', 'agendar_reunion']);

  it('builds a cache-friendly Sonnet 5.5 request with effort and default fallbacks', () => {
    const request = buildModelRequest({
      model: 'claude-sonnet-5-5',
      effort: 'low',
      system: 'SYSTEM',
      tools,
      messages,
    });

    expect(request).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: [{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }],
      cache_control: { type: 'ephemeral' },
      betas: [SERVER_SIDE_FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      messages,
    });
    // Rejected by Claude Sonnet 5.5, or not wanted: never sent.
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) {
      expect(request).not.toHaveProperty(key);
    }
    expect(request.tools?.map((t) => ('name' in t ? t.name : null))).toEqual([
      'buscar_casos',
      'crear_lead',
      'agendar_reunion',
    ]);
  });

  it('omits effort for Claude Haiku 4.5 and disables tools on the last round', () => {
    const request = buildModelRequest({
      model: 'claude-haiku-4-5',
      effort: 'high',
      system: 'S',
      tools,
      messages,
      noMoreTools: true,
    });
    expect(request).not.toHaveProperty('output_config');
    expect(request.tool_choice).toEqual({ type: 'none' });
  });

  it('defines every tool as strict with eager input streaming and no extra properties', () => {
    for (const tool of tools) {
      expect(tool).toMatchObject({ strict: true, eager_input_streaming: true });
      expect(tool.input_schema).toMatchObject({ additionalProperties: false });
    }
  });
});

describe('prompts', () => {
  it('puts the editable instructions first and the fixed rules after', () => {
    const system = buildSystemPrompt('  Eres el asistente.  ');
    expect(system).toBe(`Eres el asistente.\n\n${FIXED_RULES}`);
    expect(FIXED_RULES).toMatch(/son datos/);
    expect(FIXED_RULES).toMatch(/No reveles/);
  });

  it('renders the per-turn context with the Lima date and the case page', () => {
    const context = buildTurnContext({
      locale: 'EN',
      now: new Date('2026-11-25T15:00:00Z'),
      timeZone: 'America/Lima',
      caseSlug: 'contaflow-ia',
      caseTitle: 'ContaFlow IA',
    });
    expect(context).toBe(
      '<contexto>\nidioma_del_sitio: en\nfecha_actual: 2026-11-25 10:00 (miércoles, America/Lima)\npagina: caso "ContaFlow IA" (contaflow-ia); si pregunta por "este proyecto", se refiere a este caso\n</contexto>',
    );
  });
});

describe('toModelMessages', () => {
  it('replays user turns with their context and skips failed or empty answers', () => {
    expect(
      toModelMessages([
        { role: 'ASSISTANT', content: 'huérfano', context: null },
        { role: 'USER', content: 'Hola', context: '<contexto>c1</contexto>' },
        { role: 'ASSISTANT', content: 'Servicio caído', context: null, stopReason: 'error' },
        { role: 'USER', content: '¿Sigues?', context: '<contexto>c2</contexto>' },
        { role: 'ASSISTANT', content: '', context: null, stopReason: 'aborted' },
        { role: 'USER', content: 'Otra', context: null },
        { role: 'ASSISTANT', content: 'Respuesta', context: null, stopReason: 'end_turn' },
      ]),
    ).toEqual([
      { role: 'user', content: '<contexto>c1</contexto>\n\nHola' },
      { role: 'user', content: '<contexto>c2</contexto>\n\n¿Sigues?' },
      { role: 'user', content: 'Otra' },
      { role: 'assistant', content: 'Respuesta' },
    ]);
  });
});
