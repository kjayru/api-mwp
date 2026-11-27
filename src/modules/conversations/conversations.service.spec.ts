import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  CONVERSATION_NOT_FOUND,
  ConversationsService,
  HISTORY_TURNS,
  toAdminMessage,
} from './conversations.service.js';

const NOW = new Date('2026-11-27T10:00:00Z');

describe('ConversationsService', () => {
  const prisma = {
    conversation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    message: {
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  let service: ConversationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ConversationsService(prisma as unknown as PrismaService);
  });

  describe('chat persistence', () => {
    it('findById and create delegate to prisma', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ id: 'c1' });
      expect(await service.findById('c1')).toEqual({ id: 'c1' });
      expect(prisma.conversation.findUnique).toHaveBeenCalledWith({
        where: { id: 'c1' },
      });

      const data = {
        visitorId: 'v',
        locale: 'ES' as const,
        caseSlug: null,
        ipHash: null,
      };
      await service.create(data);
      expect(prisma.conversation.create).toHaveBeenCalledWith({ data });
    });

    it('countUserMessages counts only USER messages', async () => {
      prisma.message.count.mockResolvedValue(3);
      expect(await service.countUserMessages('c1')).toBe(3);
      expect(prisma.message.count).toHaveBeenCalledWith({
        where: { conversationId: 'c1', role: 'USER' },
      });
    });

    it('addUserMessage stores the message and bumps the conversation counters', async () => {
      prisma.message.create.mockResolvedValue({ id: 'm1' });
      prisma.conversation.update.mockResolvedValue({});

      const message = await service.addUserMessage('c1', {
        content: 'hola',
        context: '<contexto/>',
        locale: 'ES',
        caseSlug: null,
      });

      expect(message).toEqual({ id: 'm1' });
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'c1',
          role: 'USER',
          content: 'hola',
          context: '<contexto/>',
          locale: 'ES',
          caseSlug: null,
        },
      });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: {
          messageCount: { increment: 1 },
          lastMessageAt: expect.any(Date),
        },
      });
    });

    it('history returns the last turns oldest first', async () => {
      prisma.message.findMany.mockResolvedValue([
        { id: '3' },
        { id: '2' },
        { id: '1' },
      ]);

      const rows = await service.history('c1');

      expect(rows.map((r: { id: string }) => r.id)).toEqual(['1', '2', '3']);
      const args = prisma.message.findMany.mock.calls[0][0];
      expect(args.take).toBe(HISTORY_TURNS * 2);
      expect(args.where).toEqual({ conversationId: 'c1' });
    });

    describe('completeTurn', () => {
      const turn = {
        content: 'respuesta',
        sources: [{ id: 's' }],
        toolCalls: [],
        usage: { input: 1 },
        model: 'claude-sonnet-5-5',
        stopReason: 'end_turn',
        unanswered: false,
      };

      it('stores the answer, clears the question flag and does not flag the conversation', async () => {
        prisma.message.create.mockResolvedValue({ id: 'a1' });

        const message = await service.completeTurn('c1', 'u1', turn);

        expect(message).toEqual({ id: 'a1' });
        expect(prisma.message.create.mock.calls[0][0].data).toMatchObject({
          conversationId: 'c1',
          role: 'ASSISTANT',
          content: 'respuesta',
          model: 'claude-sonnet-5-5',
          stopReason: 'end_turn',
        });
        expect(prisma.message.update).toHaveBeenCalledWith({
          where: { id: 'u1' },
          data: { unanswered: false },
        });
        expect(
          prisma.conversation.update.mock.calls[0][0].data,
        ).not.toHaveProperty('unanswered');
      });

      it('flags the question and the conversation when unanswered', async () => {
        prisma.message.create.mockResolvedValue({ id: 'a1' });

        await service.completeTurn('c1', 'u1', { ...turn, unanswered: true });

        expect(prisma.message.update).toHaveBeenCalledWith({
          where: { id: 'u1' },
          data: { unanswered: true },
        });
        expect(prisma.conversation.update.mock.calls[0][0].data).toMatchObject({
          unanswered: true,
          messageCount: { increment: 1 },
        });
      });
    });
  });

  describe('list', () => {
    const row = (over: object = {}) => ({
      id: 'c1',
      locale: 'ES',
      caseSlug: null,
      messageCount: 2,
      hasLead: false,
      unanswered: false,
      createdAt: NOW,
      lastMessageAt: NOW,
      messages: [{ content: 'Pregunta' }],
      leads: [],
      ...over,
    });

    beforeEach(() => {
      prisma.conversation.findMany.mockResolvedValue([row()]);
      prisma.conversation.count.mockResolvedValue(1);
    });

    it('uses an empty where without filters and paginates', async () => {
      const out = await service.list({ page: 2, limit: 5 } as never);

      const args = prisma.conversation.findMany.mock.calls[0][0];
      expect(args.where).toEqual({});
      expect(args.skip).toBe(5);
      expect(args.take).toBe(5);
      expect(out.meta).toEqual({ page: 2, limit: 5, total: 1 });
      expect(out.data[0]).toMatchObject({
        id: 'c1',
        firstQuestion: 'Pregunta',
        lead: null,
      });
    });

    it.each([
      ['lead', { hasLead: true }],
      ['unanswered', { unanswered: true }],
    ])('filter=%s adds its condition', async (filter, cond) => {
      await service.list({ page: 1, limit: 20, filter } as never);
      expect(prisma.conversation.findMany.mock.calls[0][0].where).toEqual({
        AND: [cond],
      });
      expect(prisma.conversation.count.mock.calls[0][0].where).toEqual({
        AND: [cond],
      });
    });

    it('q searches messages and non-deleted lead name/email, combined with the filter', async () => {
      await service.list({
        page: 1,
        limit: 20,
        filter: 'lead',
        q: 'ana',
      } as never);
      const { AND } = prisma.conversation.findMany.mock.calls[0][0].where;
      expect(AND).toHaveLength(2);
      const or = AND[1].OR;
      expect(or[0]).toEqual({
        messages: {
          some: { content: { contains: 'ana', mode: 'insensitive' } },
        },
      });
      expect(or[1].leads.some.deletedAt).toBeNull();
      expect(or[1].leads.some.OR).toHaveLength(2);
    });

    it('truncates the first question and exposes the first lead; null without questions', async () => {
      const lead = { id: 'l1', name: 'Ana', email: 'a@x.com', status: 'NEW' };
      prisma.conversation.findMany.mockResolvedValue([
        row({ messages: [{ content: 'x'.repeat(400) }], leads: [lead] }),
        row({ id: 'c2', messages: [] }),
      ]);

      const out = await service.list({ page: 1, limit: 20 } as never);

      expect(out.data[0].firstQuestion).toHaveLength(300);
      expect(out.data[0].lead).toEqual(lead);
      expect(out.data[1].firstQuestion).toBeNull();
    });
  });

  describe('detail', () => {
    it('404 when the conversation does not exist', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      const error = await service.detail('x').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as Error).message).toBe(CONVERSATION_NOT_FOUND);
    });

    const message = {
      id: 'm1',
      role: 'USER',
      content: 'hola',
      locale: 'ES',
      caseSlug: null,
      sources: null,
      toolCalls: null,
      usage: null,
      model: null,
      stopReason: null,
      unanswered: false,
      createdAt: NOW,
      context: 'secret-context',
      conversationId: 'c1',
    };

    it('maps lead, meetings and messages (without internal fields)', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'c1',
        visitorId: 'v1',
        locale: 'ES',
        caseSlug: 'caso',
        messageCount: 1,
        hasLead: true,
        unanswered: false,
        createdAt: NOW,
        lastMessageAt: NOW,
        ipHash: 'hash',
        messages: [message],
        leads: [
          {
            id: 'l1',
            name: 'Ana',
            email: 'a@x.com',
            phone: null,
            interest: 'web',
            message: 'hi',
            status: 'NEW',
            createdAt: NOW,
            deletedAt: null,
          },
        ],
        meetings: [
          {
            id: 'mt1',
            status: 'CONFIRMED',
            start: NOW,
            end: NOW,
            timezone: 'America/Lima',
            meetLink: 'https://meet',
            googleEventId: 'g1',
            extra: 'x',
          },
        ],
      });

      const out = await service.detail('c1');

      expect(out.visitorId).toBe('v1');
      expect(out).not.toHaveProperty('ipHash');
      expect(out.lead).toEqual({
        id: 'l1',
        name: 'Ana',
        email: 'a@x.com',
        phone: null,
        interest: 'web',
        message: 'hi',
        status: 'NEW',
        createdAt: NOW,
      });
      expect(out.meetings[0]).toEqual({
        id: 'mt1',
        status: 'CONFIRMED',
        start: NOW,
        end: NOW,
        timezone: 'America/Lima',
        meetLink: 'https://meet',
        googleEventId: 'g1',
      });
      expect(out.messages[0]).not.toHaveProperty('context');
      expect(out.messages[0].content).toBe('hola');
    });

    it('lead is null when the conversation has none', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'c1',
        visitorId: 'v1',
        locale: 'EN',
        caseSlug: null,
        messageCount: 0,
        hasLead: false,
        unanswered: false,
        createdAt: NOW,
        lastMessageAt: NOW,
        messages: [],
        leads: [],
        meetings: [],
      });
      const out = await service.detail('c1');
      expect(out.lead).toBeNull();
      expect(out.meetings).toEqual([]);
    });
  });

  describe('unanswered', () => {
    it('returns the count and the newest questions within the window', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      prisma.message.count.mockResolvedValue(7);
      prisma.message.findMany.mockResolvedValue([
        {
          id: 'm1',
          conversationId: 'c1',
          content: '¿Hacen apps?',
          locale: 'ES',
          createdAt: NOW,
        },
      ]);

      const out = await service.unanswered(7, 5);

      vi.useRealTimers();
      expect(out).toEqual({
        days: 7,
        count: 7,
        questions: [
          {
            messageId: 'm1',
            conversationId: 'c1',
            question: '¿Hacen apps?',
            locale: 'ES',
            createdAt: NOW,
          },
        ],
      });
      const where = prisma.message.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ role: 'USER', unanswered: true });
      expect(where.createdAt.gte).toEqual(
        new Date(NOW.getTime() - 7 * 86_400_000),
      );
      expect(prisma.message.findMany.mock.calls[0][0].take).toBe(5);
    });

    it('defaults to 20 questions', async () => {
      prisma.message.count.mockResolvedValue(0);
      prisma.message.findMany.mockResolvedValue([]);
      await service.unanswered(30);
      expect(prisma.message.findMany.mock.calls[0][0].take).toBe(20);
    });
  });

  it('toAdminMessage keeps only the admin-facing fields', () => {
    const out = toAdminMessage({
      id: 'm',
      role: 'ASSISTANT',
      content: 'x',
      locale: null,
      caseSlug: null,
      sources: [],
      toolCalls: [],
      usage: null,
      model: 'm',
      stopReason: 'end_turn',
      unanswered: false,
      createdAt: NOW,
      context: 'internal',
      conversationId: 'c',
    } as never);
    expect(out).not.toHaveProperty('context');
    expect(out).not.toHaveProperty('conversationId');
    expect(out.role).toBe('ASSISTANT');
  });
});
