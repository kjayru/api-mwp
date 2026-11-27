import Anthropic from '@anthropic-ai/sdk';
import {
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AssistantSettingsService } from '../assistant-settings/assistant-settings.service.js';
import type { MeetingsService } from '../calendar/meetings.service.js';
import type { ConversationsService } from '../conversations/conversations.service.js';
import type { AssistantEngineService } from './assistant-engine.service.js';
import {
  AssistantService,
  type PreparedTurn,
  toModelMessages,
} from './assistant.service.js';

const settings = {
  model: 'claude-sonnet-5-5',
  effort: 'low',
  instructions: 'x',
  enabledTools: ['buscar_casos', 'crear_lead', 'agendar_reunion'],
  maxMessagesPerSession: 3,
  updatedAt: new Date(),
};

describe('toModelMessages', () => {
  it('prefixes user turns with their context and keeps assistant text', () => {
    expect(
      toModelMessages([
        { role: 'USER', content: 'hola', context: '<ctx>' },
        { role: 'ASSISTANT', content: 'qué tal', context: null },
        { role: 'USER', content: 'bien', context: null },
      ]),
    ).toEqual([
      { role: 'user', content: '<ctx>\n\nhola' },
      { role: 'assistant', content: 'qué tal' },
      { role: 'user', content: 'bien' },
    ]);
  });

  it('skips failed and empty assistant answers', () => {
    expect(
      toModelMessages([
        { role: 'USER', content: 'a', context: null },
        { role: 'ASSISTANT', content: 'fallo', context: null, stopReason: 'error' },
        { role: 'USER', content: 'b', context: null },
        { role: 'ASSISTANT', content: '   ', context: null },
      ]),
    ).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
  });

  it('always starts with a user turn', () => {
    expect(
      toModelMessages([
        { role: 'ASSISTANT', content: 'huérfano', context: null },
        { role: 'USER', content: 'q', context: null },
      ]),
    ).toEqual([{ role: 'user', content: 'q' }]);
    expect(toModelMessages([])).toEqual([]);
  });
});

describe('AssistantService', () => {
  const engine = { configured: true, run: vi.fn() };
  const settingsService = { get: vi.fn() };
  const conversations = {
    findById: vi.fn(),
    create: vi.fn(),
    countUserMessages: vi.fn(),
    addUserMessage: vi.fn(),
    history: vi.fn(),
    completeTurn: vi.fn(),
  };
  const meetings = { settings: vi.fn() };
  const prisma = { caseTranslation: { findMany: vi.fn() } };
  const config = { get: vi.fn().mockReturnValue('jwt-secret-for-tests') };
  let service: AssistantService;

  const dto = (over: object = {}) =>
    ({
      visitorId: 'visitor-1',
      locale: 'es',
      message: '¿Qué hacen?',
      ...over,
    }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
    engine.configured = true;
    settingsService.get.mockResolvedValue(settings);
    meetings.settings.mockResolvedValue({ timeZone: 'America/Lima' });
    conversations.create.mockResolvedValue({ id: 'conv-1', visitorId: 'visitor-1' });
    conversations.addUserMessage.mockResolvedValue({ id: 'um-1' });
    conversations.history.mockResolvedValue([
      { id: 'um-1', role: 'USER', content: '¿Qué hacen?', context: '<ctx>' },
    ]);
    prisma.caseTranslation.findMany.mockResolvedValue([]);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    service = new AssistantService(
      engine as unknown as AssistantEngineService,
      settingsService as unknown as AssistantSettingsService,
      conversations as unknown as ConversationsService,
      meetings as unknown as MeetingsService,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService<never, true>,
    );
  });

  afterEach(() => vi.restoreAllMocks());

  describe('startTurn', () => {
    it('503 in the visitor language when the engine has no API key', async () => {
      engine.configured = false;
      const error = await service.startTurn(dto({ locale: 'en' }), '1.2.3.4').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).toContain('not available');
      expect(conversations.create).not.toHaveBeenCalled();
    });

    it('creates a conversation with a hashed IP and stores the user message', async () => {
      const turn = await service.startTurn(dto(), '203.0.113.9');

      const created = conversations.create.mock.calls[0][0];
      expect(created).toMatchObject({
        visitorId: 'visitor-1',
        locale: 'ES',
        caseSlug: null,
      });
      expect(created.ipHash).toMatch(/^[0-9a-f]{32}$/);
      expect(created.ipHash).not.toContain('203');
      expect(conversations.addUserMessage).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({ content: '¿Qué hacen?', locale: 'ES', caseSlug: null }),
      );
      expect(turn).toMatchObject({
        conversationId: 'conv-1',
        userMessageId: 'um-1',
        locale: 'ES',
        caseSlug: null,
        settings,
        messages: [{ role: 'user', content: '<ctx>\n\n¿Qué hacen?' }],
      });
    });

    it('stores no IP hash when the IP is unknown, and hashes deterministically otherwise', async () => {
      await service.startTurn(dto(), undefined);
      expect(conversations.create.mock.calls[0][0].ipHash).toBeNull();

      await service.startTurn(dto(), '10.0.0.1');
      await service.startTurn(dto(), '10.0.0.1');
      await service.startTurn(dto(), '10.0.0.2');
      const [, a, b, c] = conversations.create.mock.calls.map((x) => x[0].ipHash);
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });

    it('404 when the conversation does not exist', async () => {
      conversations.findById.mockResolvedValue(null);
      await expect(
        service.startTurn(dto({ conversationId: 'nope' }), undefined),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 when the conversation belongs to another visitor', async () => {
      conversations.findById.mockResolvedValue({ id: 'conv-1', visitorId: 'someone-else' });
      await expect(
        service.startTurn(dto({ conversationId: 'conv-1' }), undefined),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(conversations.addUserMessage).not.toHaveBeenCalled();
    });

    it('continues an existing conversation below the limit without creating a new one', async () => {
      conversations.findById.mockResolvedValue({ id: 'conv-1', visitorId: 'visitor-1' });
      conversations.countUserMessages.mockResolvedValue(2);

      const turn = await service.startTurn(dto({ conversationId: 'conv-1' }), undefined);

      expect(conversations.create).not.toHaveBeenCalled();
      expect(turn.conversationId).toBe('conv-1');
    });

    it('429 with details at the per-session limit and stores nothing', async () => {
      conversations.findById.mockResolvedValue({ id: 'conv-1', visitorId: 'visitor-1' });
      conversations.countUserMessages.mockResolvedValue(3);

      const error = (await service
        .startTurn(dto({ conversationId: 'conv-1' }), undefined)
        .catch((e: unknown) => e)) as HttpException;

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(429);
      expect(error.getResponse()).toMatchObject({
        error: 'Too Many Requests',
        details: { reason: 'session_limit', limit: 3 },
        message: expect.stringContaining('límite de 3 mensajes'),
      });
      expect(conversations.addUserMessage).not.toHaveBeenCalled();
    });

    it('uses the published case of the requested slug, preferring the locale', async () => {
      prisma.caseTranslation.findMany.mockResolvedValue([
        { slug: 'caso-en', title: 'Case', locale: 'EN' },
        { slug: 'caso-es', title: 'Caso', locale: 'ES' },
      ]);

      const turn = await service.startTurn(dto({ caseSlug: 'caso-es' }), undefined);

      expect(turn.caseSlug).toBe('caso-es');
      expect(prisma.caseTranslation.findMany.mock.calls[0][0].where).toMatchObject({
        slug: 'caso-es',
        status: 'PUBLISHED',
        case: { deletedAt: null },
      });
      expect(conversations.create.mock.calls[0][0].caseSlug).toBe('caso-es');
    });

    it('falls back to another locale of the case, and to null when it is unknown', async () => {
      prisma.caseTranslation.findMany.mockResolvedValue([
        { slug: 'case-en', title: 'Case', locale: 'EN' },
      ]);
      expect((await service.startTurn(dto({ caseSlug: 'x' }), undefined)).caseSlug).toBe('case-en');

      prisma.caseTranslation.findMany.mockResolvedValue([]);
      expect((await service.startTurn(dto({ caseSlug: 'x' }), undefined)).caseSlug).toBeNull();
    });
  });

  describe('streamTurn', () => {
    const turn: PreparedTurn = {
      conversationId: 'conv-1',
      userMessageId: 'um-1',
      locale: 'ES',
      caseSlug: null,
      settings: settings as never,
      messages: [{ role: 'user', content: 'hola' }],
    };
    const result = {
      text: 'Respuesta',
      sources: [{ id: 's1' }],
      toolCalls: [],
      usage: { inputTokens: 1 },
      model: 'claude-sonnet-5-5',
      stopReason: 'end_turn',
      unanswered: false,
    };
    const sse = () => ({ send: vi.fn() });
    const events = (s: { send: ReturnType<typeof vi.fn> }) => s.send.mock.calls.map((c) => c[0]);

    it('streams conversation, deltas, sources and done, and stores the answer', async () => {
      conversations.completeTurn.mockResolvedValue({ id: 'am-1' });
      engine.run.mockImplementation(async (_req, handlers) => {
        handlers.delta('Resp');
        handlers.tool({ name: 'buscar_casos' });
        handlers.lead({ id: 'l' });
        handlers.meeting({ id: 'm' });
        return result;
      });
      const stream = sse();
      const signal = new AbortController().signal;

      await service.streamTurn(turn, stream as never, signal);

      expect(events(stream)).toEqual([
        'conversation',
        'delta',
        'tool',
        'lead',
        'meeting',
        'sources',
        'done',
      ]);
      expect(stream.send).toHaveBeenCalledWith('delta', { text: 'Resp' });
      expect(stream.send).toHaveBeenLastCalledWith('done', {
        messageId: 'am-1',
        stopReason: 'end_turn',
        unanswered: false,
        content: 'Respuesta',
        usage: result.usage,
      });
      const request = engine.run.mock.calls[0][0];
      expect(request.tools).toEqual(settings.enabledTools);
      expect(request.signal).toBe(signal);
      expect(request.context).toEqual({
        conversationId: 'conv-1',
        locale: 'ES',
        caseSlug: null,
      });
      expect(conversations.completeTurn).toHaveBeenCalledWith(
        'conv-1',
        'um-1',
        expect.objectContaining({ content: 'Respuesta', stopReason: 'end_turn', unanswered: false }),
      );
    });

    it('stores an aborted turn but sends no sources or done', async () => {
      conversations.completeTurn.mockResolvedValue({ id: 'am-1' });
      engine.run.mockResolvedValue({ ...result, stopReason: 'aborted' });
      const stream = sse();

      await service.streamTurn(turn, stream as never, new AbortController().signal);

      expect(conversations.completeTurn).toHaveBeenCalled();
      expect(events(stream)).toEqual(['conversation']);
    });

    it('on engine failure stores a visitor-safe error answer and emits error without internals', async () => {
      engine.run.mockRejectedValue(new Error('secret upstream detail'));
      conversations.completeTurn.mockResolvedValue({ id: 'am-1' });
      const stream = sse();

      await service.streamTurn(turn, stream as never, new AbortController().signal);

      expect(conversations.completeTurn).toHaveBeenCalledWith(
        'conv-1',
        'um-1',
        expect.objectContaining({
          stopReason: 'error',
          unanswered: false,
          usage: null,
          content: expect.stringContaining('no está disponible'),
        }),
      );
      const last = stream.send.mock.calls.at(-1)!;
      expect(last[0]).toBe('error');
      expect(JSON.stringify(last[1])).not.toContain('secret');
      expect(events(stream)).not.toContain('done');
    });

    it('answers in English on failure for an EN turn, and tolerates an Anthropic API error', async () => {
      engine.run.mockRejectedValue(
        new Anthropic.APIError(529, {}, 'overloaded', new Headers()),
      );
      conversations.completeTurn.mockResolvedValue({ id: 'am-1' });
      const stream = sse();

      await service.streamTurn({ ...turn, locale: 'EN' }, stream as never, new AbortController().signal);

      expect(stream.send).toHaveBeenLastCalledWith('error', {
        message: expect.stringContaining('not available'),
      });
    });

    it('still emits error when storing the failure message also fails', async () => {
      engine.run.mockRejectedValue(new Error('boom'));
      conversations.completeTurn.mockRejectedValue(new Error('db down'));
      const stream = sse();

      await expect(
        service.streamTurn(turn, stream as never, new AbortController().signal),
      ).resolves.toBeUndefined();
      expect(stream.send.mock.calls.at(-1)![0]).toBe('error');
    });

    it('emits error (never throws) when persisting a successful turn fails', async () => {
      engine.run.mockResolvedValue(result);
      conversations.completeTurn.mockRejectedValue(new Error('db down'));
      const stream = sse();

      await expect(
        service.streamTurn(turn, stream as never, new AbortController().signal),
      ).resolves.toBeUndefined();
      expect(events(stream)).toEqual(['conversation', 'error']);
    });
  });

  describe('test', () => {
    const result = {
      text: 'Ok',
      sources: [],
      toolCalls: [],
      usage: { inputTokens: 2 },
      model: 'claude-sonnet-5-5',
      stopReason: 'end_turn',
      unanswered: true,
    };

    it('503 without an API key', async () => {
      engine.configured = false;
      await expect(
        service.test({ locale: 'es', question: 'q' } as never),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(engine.run).not.toHaveBeenCalled();
    });

    it('runs one question without persistence and only offers buscar_casos', async () => {
      engine.run.mockResolvedValue(result);

      const out = await service.test({ locale: 'es', question: '¿Precios?' } as never);

      const request = engine.run.mock.calls[0][0];
      expect(request.tools).toEqual(['buscar_casos']);
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0].content).toMatch(/\n\n¿Precios\?$/);
      expect(request.context).toEqual({ conversationId: null, locale: 'ES', caseSlug: null });
      expect(out).toEqual({
        answer: 'Ok',
        sources: [],
        usage: result.usage,
        model: 'claude-sonnet-5-5',
        stopReason: 'end_turn',
        unanswered: true,
        toolCalls: [],
      });
      expect(conversations.addUserMessage).not.toHaveBeenCalled();
      expect(conversations.completeTurn).not.toHaveBeenCalled();
    });

    it('passes the published case of the slug in the context', async () => {
      engine.run.mockResolvedValue(result);
      prisma.caseTranslation.findMany.mockResolvedValue([
        { slug: 'caso', title: 'Caso', locale: 'EN' },
      ]);
      await service.test({ locale: 'en', question: 'q', caseSlug: 'caso' } as never);
      expect(engine.run.mock.calls[0][0].context.caseSlug).toBe('caso');
    });
  });
});
