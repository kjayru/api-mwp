import { Injectable, NotFoundException } from '@nestjs/common';
import type { Message, Prisma } from '../../generated/prisma/client.js';
import type {
  LeadStatus,
  Locale,
  MeetingStatus,
  MessageRole,
} from '../../generated/prisma/enums.js';
import type { Paginated } from '../../common/pagination/pagination.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AdminConversationsQueryDto } from './dto/conversations-query.dto.js';

export const CONVERSATION_NOT_FOUND = 'Conversación no encontrada';
/** Turns (user + assistant pairs) replayed to the model. */
export const HISTORY_TURNS = 12;

export interface LeadSummary {
  id: string;
  name: string;
  email: string;
  status: LeadStatus;
}

export interface AdminConversationListItem {
  id: string;
  locale: Locale;
  caseSlug: string | null;
  /** First visitor message (truncated to 300 characters). */
  firstQuestion: string | null;
  messageCount: number;
  hasLead: boolean;
  unanswered: boolean;
  createdAt: Date;
  lastMessageAt: Date;
  lead: LeadSummary | null;
}

export interface AdminMessage {
  id: string;
  role: MessageRole;
  content: string;
  locale: Locale | null;
  caseSlug: string | null;
  sources: unknown;
  toolCalls: unknown;
  usage: unknown;
  model: string | null;
  stopReason: string | null;
  unanswered: boolean;
  createdAt: Date;
}

export interface AdminConversationDetail
  extends Omit<AdminConversationListItem, 'firstQuestion' | 'lead'> {
  visitorId: string;
  lead: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    interest: string | null;
    message: string | null;
    status: LeadStatus;
    createdAt: Date;
  } | null;
  meetings: {
    id: string;
    status: MeetingStatus;
    start: Date;
    end: Date;
    timezone: string;
    meetLink: string | null;
    googleEventId: string | null;
  }[];
  messages: AdminMessage[];
}

export interface UnansweredQuestion {
  messageId: string;
  conversationId: string;
  question: string;
  locale: Locale | null;
  createdAt: Date;
}

export interface AssistantTurnRecord {
  content: string;
  sources: unknown;
  toolCalls: unknown;
  usage: unknown;
  model: string;
  stopReason: string;
  unanswered: boolean;
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** A stored message as the admin sees it (conversation and lead details). */
export function toAdminMessage(m: Message): AdminMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    locale: m.locale,
    caseSlug: m.caseSlug,
    sources: m.sources,
    toolCalls: m.toolCalls,
    usage: m.usage,
    model: m.model,
    stopReason: m.stopReason,
    unanswered: m.unanswered,
    createdAt: m.createdAt,
  };
}

/** Conversations, messages and their flags (chat persistence and admin reads). */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  findById(id: string) {
    return this.prisma.conversation.findUnique({ where: { id } });
  }

  create(data: {
    visitorId: string;
    locale: Locale;
    caseSlug: string | null;
    ipHash: string | null;
  }) {
    return this.prisma.conversation.create({ data });
  }

  countUserMessages(conversationId: string): Promise<number> {
    return this.prisma.message.count({
      where: { conversationId, role: 'USER' },
    });
  }

  async addUserMessage(
    conversationId: string,
    data: {
      content: string;
      context: string;
      locale: Locale;
      caseSlug: string | null;
    },
  ) {
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: { conversationId, role: 'USER', ...data },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { messageCount: { increment: 1 }, lastMessageAt: new Date() },
      }),
    ]);
    return message;
  }

  /** The last HISTORY_TURNS turns, oldest first. */
  async history(conversationId: string) {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_TURNS * 2,
      select: {
        id: true,
        role: true,
        content: true,
        context: true,
        stopReason: true,
      },
    });
    return rows.reverse();
  }

  async completeTurn(
    conversationId: string,
    userMessageId: string,
    turn: AssistantTurnRecord,
  ) {
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: turn.content,
          sources: json(turn.sources),
          toolCalls: json(turn.toolCalls),
          usage: json(turn.usage),
          model: turn.model,
          stopReason: turn.stopReason,
        },
      }),
      this.prisma.message.update({
        where: { id: userMessageId },
        data: { unanswered: turn.unanswered },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          messageCount: { increment: 1 },
          lastMessageAt: new Date(),
          ...(turn.unanswered ? { unanswered: true } : {}),
        },
      }),
    ]);
    return message;
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  async list(
    query: AdminConversationsQueryDto,
  ): Promise<Paginated<AdminConversationListItem>> {
    const { page, limit, filter, q } = query;
    const and: Prisma.ConversationWhereInput[] = [];
    if (filter === 'lead') and.push({ hasLead: true });
    if (filter === 'unanswered') and.push({ unanswered: true });
    if (q) {
      and.push({
        OR: [
          { messages: { some: { content: { contains: q, mode: 'insensitive' } } } },
          {
            leads: {
              some: {
                deletedAt: null,
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { email: { contains: q, mode: 'insensitive' } },
                ],
              },
            },
          },
        ],
      });
    }
    const where: Prisma.ConversationWhereInput =
      and.length > 0 ? { AND: and } : {};
    const [rows, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          messages: {
            where: { role: 'USER' },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 1,
            select: { content: true },
          },
          leads: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { id: true, name: true, email: true, status: true },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        locale: row.locale,
        caseSlug: row.caseSlug,
        firstQuestion: row.messages[0]?.content.slice(0, 300) ?? null,
        messageCount: row.messageCount,
        hasLead: row.hasLead,
        unanswered: row.unanswered,
        createdAt: row.createdAt,
        lastMessageAt: row.lastMessageAt,
        lead: row.leads[0] ?? null,
      })),
      meta: { page, limit, total },
    };
  }

  async detail(id: string): Promise<AdminConversationDetail> {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        leads: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
        meetings: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException(CONVERSATION_NOT_FOUND);
    const lead = row.leads[0];
    return {
      id: row.id,
      visitorId: row.visitorId,
      locale: row.locale,
      caseSlug: row.caseSlug,
      messageCount: row.messageCount,
      hasLead: row.hasLead,
      unanswered: row.unanswered,
      createdAt: row.createdAt,
      lastMessageAt: row.lastMessageAt,
      lead: lead
        ? {
            id: lead.id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            interest: lead.interest,
            message: lead.message,
            status: lead.status,
            createdAt: lead.createdAt,
          }
        : null,
      meetings: row.meetings.map((m) => ({
        id: m.id,
        status: m.status,
        start: m.start,
        end: m.end,
        timezone: m.timezone,
        meetLink: m.meetLink,
        googleEventId: m.googleEventId,
      })),
      messages: row.messages.map(toAdminMessage),
    };
  }

  /** Questions marked "sin respuesta" in the last `days` days (newest first). */
  async unanswered(
    days: number,
    take = 20,
  ): Promise<{ days: number; count: number; questions: UnansweredQuestion[] }> {
    const since = new Date(Date.now() - days * 86_400_000);
    const where: Prisma.MessageWhereInput = {
      role: 'USER',
      unanswered: true,
      createdAt: { gte: since },
    };
    const [count, rows] = await Promise.all([
      this.prisma.message.count({ where }),
      this.prisma.message.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          conversationId: true,
          content: true,
          locale: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      days,
      count,
      questions: rows.map((row) => ({
        messageId: row.id,
        conversationId: row.conversationId,
        question: row.content,
        locale: row.locale,
        createdAt: row.createdAt,
      })),
    };
  }
}
