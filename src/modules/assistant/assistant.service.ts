import Anthropic from '@anthropic-ai/sdk';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { toDbLocale } from '../../common/i18n/locale.js';
import type { Env } from '../../config/env.js';
import type { Locale } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AssistantSettingsService,
  type AssistantSettingsView,
} from '../assistant-settings/assistant-settings.service.js';
import { MeetingsService } from '../calendar/meetings.service.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import {
  AssistantEngineService,
  type CitedSource,
  type EngineResult,
  type TurnUsage,
} from './assistant-engine.service.js';
import type { AssistantTestDto, ChatRequestDto } from './dto/chat.dto.js';
import { buildTurnContext } from './prompt.js';
import type { SseStream } from './sse.js';
import type { ToolCallRecord } from './tools/assistant-tools.service.js';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

const COPY = {
  ES: {
    notFound: 'Conversación no encontrada',
    limit: (n: number) =>
      `Has alcanzado el límite de ${n} mensajes en esta conversación. Si quieres seguir, escríbenos desde la página de contacto y te responderemos.`,
    unavailable:
      'El asistente no está disponible en este momento. Inténtalo de nuevo en unos minutos.',
  },
  EN: {
    notFound: 'Conversation not found',
    limit: (n: number) =>
      `You have reached the limit of ${n} messages in this conversation. If you want to continue, write to us from the contact page and we will get back to you.`,
    unavailable:
      'The assistant is not available right now. Please try again in a few minutes.',
  },
} as const;

export interface PreparedTurn {
  conversationId: string;
  userMessageId: string;
  locale: Locale;
  caseSlug: string | null;
  settings: AssistantSettingsView;
  messages: MessageParam[];
}

export interface AssistantTestResult {
  answer: string;
  sources: CitedSource[];
  usage: TurnUsage;
  model: string;
  stopReason: string;
  unanswered: boolean;
  toolCalls: ToolCallRecord[];
}

interface HistoryRow {
  role: 'USER' | 'ASSISTANT';
  content: string;
  context: string | null;
  stopReason?: string | null;
}

/**
 * Model messages from stored rows: user turns carry their <contexto> block;
 * assistant turns are the final text. Failed or empty answers are skipped
 * (consecutive user turns are fine), and the list starts with a user turn.
 */
export function toModelMessages(rows: HistoryRow[]): MessageParam[] {
  const messages: MessageParam[] = [];
  for (const row of rows) {
    if (row.role === 'USER') {
      messages.push({
        role: 'user',
        content: row.context ? `${row.context}\n\n${row.content}` : row.content,
      });
    } else if (row.content.trim() && row.stopReason !== 'error') {
      messages.push({ role: 'assistant', content: row.content });
    }
  }
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift();
  return messages;
}

/** Public chat: conversation handling, persistence and SSE. */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly ipSecret: string;

  constructor(
    private readonly engine: AssistantEngineService,
    private readonly settings: AssistantSettingsService,
    private readonly conversations: ConversationsService,
    private readonly meetings: MeetingsService,
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.ipSecret = config.get('JWT_SECRET', { infer: true });
  }

  /**
   * Everything that can fail with a plain HTTP error, before the SSE stream
   * opens: 503 without API key, 404 for a conversation of another visitor,
   * 429 past the per-session limit. Stores the user message.
   */
  async startTurn(dto: ChatRequestDto, ip: string | undefined): Promise<PreparedTurn> {
    const locale = toDbLocale(dto.locale);
    const copy = COPY[locale];
    if (!this.engine.configured) {
      throw new ServiceUnavailableException(copy.unavailable);
    }
    const settings = await this.settings.get();

    let conversation = dto.conversationId
      ? await this.conversations.findById(dto.conversationId)
      : null;
    if (dto.conversationId && (!conversation || conversation.visitorId !== dto.visitorId)) {
      throw new NotFoundException(copy.notFound);
    }

    const caseInfo = dto.caseSlug
      ? await this.publishedCase(dto.caseSlug, locale)
      : null;
    if (!conversation) {
      conversation = await this.conversations.create({
        visitorId: dto.visitorId,
        locale,
        caseSlug: caseInfo?.slug ?? null,
        ipHash: ip ? this.hashIp(ip) : null,
      });
    } else {
      const sent = await this.conversations.countUserMessages(conversation.id);
      if (sent >= settings.maxMessagesPerSession) {
        throw new HttpException(
          {
            message: copy.limit(settings.maxMessagesPerSession),
            error: 'Too Many Requests',
            details: {
              reason: 'session_limit',
              limit: settings.maxMessagesPerSession,
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const { timeZone } = await this.meetings.settings();
    const context = buildTurnContext({
      locale,
      now: new Date(),
      timeZone,
      caseSlug: caseInfo?.slug,
      caseTitle: caseInfo?.title,
    });
    const userMessage = await this.conversations.addUserMessage(conversation.id, {
      content: dto.message,
      context,
      locale,
      caseSlug: caseInfo?.slug ?? null,
    });
    const history = await this.conversations.history(conversation.id);
    return {
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      locale,
      caseSlug: caseInfo?.slug ?? null,
      settings,
      messages: toModelMessages(history as HistoryRow[]),
    };
  }

  /** Runs the turn over SSE and stores the answer. Never throws. */
  async streamTurn(
    turn: PreparedTurn,
    sse: SseStream,
    signal: AbortSignal,
  ): Promise<void> {
    sse.send('conversation', { conversationId: turn.conversationId });
    let result: EngineResult;
    try {
      result = await this.engine.run(
        {
          settings: turn.settings,
          tools: turn.settings.enabledTools,
          messages: turn.messages,
          context: {
            conversationId: turn.conversationId,
            locale: turn.locale,
            caseSlug: turn.caseSlug,
          },
          signal,
        },
        {
          delta: (text) => sse.send('delta', { text }),
          tool: (payload) => sse.send('tool', payload),
          lead: (payload) => sse.send('lead', payload),
          meeting: (payload) => sse.send('meeting', payload),
        },
      );
    } catch (error) {
      this.logError(error);
      const message = COPY[turn.locale].unavailable;
      await this.conversations
        .completeTurn(turn.conversationId, turn.userMessageId, {
          content: message,
          sources: [],
          toolCalls: [],
          usage: null,
          model: turn.settings.model,
          stopReason: 'error',
          unanswered: false,
        })
        .catch((e: unknown) => this.logError(e));
      sse.send('error', { message });
      return;
    }

    try {
      const stored = await this.conversations.completeTurn(
        turn.conversationId,
        turn.userMessageId,
        {
          content: result.text,
          sources: result.sources,
          toolCalls: result.toolCalls,
          usage: result.usage,
          model: result.model,
          stopReason: result.stopReason,
          unanswered: result.unanswered,
        },
      );
      if (result.stopReason === 'aborted') return;
      sse.send('sources', result.sources);
      sse.send('done', {
        messageId: stored.id,
        stopReason: result.stopReason,
        unanswered: result.unanswered,
        content: result.text,
        usage: result.usage,
      });
    } catch (error) {
      this.logError(error);
      sse.send('error', { message: COPY[turn.locale].unavailable });
    }
  }

  /**
   * "Probar pregunta": one question, no history, no persistence; only
   * buscar_casos is offered (no leads or meetings in test mode).
   */
  async test(dto: AssistantTestDto): Promise<AssistantTestResult> {
    const locale = toDbLocale(dto.locale);
    if (!this.engine.configured) {
      throw new ServiceUnavailableException(COPY[locale].unavailable);
    }
    const settings = await this.settings.get();
    const caseInfo = dto.caseSlug
      ? await this.publishedCase(dto.caseSlug, locale)
      : null;
    const { timeZone } = await this.meetings.settings();
    const context = buildTurnContext({
      locale,
      now: new Date(),
      timeZone,
      caseSlug: caseInfo?.slug,
      caseTitle: caseInfo?.title,
    });
    const result = await this.engine.run({
      settings,
      tools: settings.enabledTools.filter((tool) => tool === 'buscar_casos'),
      messages: [{ role: 'user', content: `${context}\n\n${dto.question}` }],
      context: { conversationId: null, locale, caseSlug: caseInfo?.slug ?? null },
    });
    return {
      answer: result.text,
      sources: result.sources,
      usage: result.usage,
      model: result.model,
      stopReason: result.stopReason,
      unanswered: result.unanswered,
      toolCalls: result.toolCalls,
    };
  }

  /** Published case translation by slug (this locale first); null when unknown. */
  private async publishedCase(
    slug: string,
    locale: Locale,
  ): Promise<{ slug: string; title: string } | null> {
    const rows = await this.prisma.caseTranslation.findMany({
      where: { slug, status: 'PUBLISHED', case: { deletedAt: null } },
      select: { slug: true, title: true, locale: true },
    });
    const row = rows.find((r) => r.locale === locale) ?? rows[0];
    return row ? { slug: row.slug, title: row.title } : null;
  }

  private hashIp(ip: string): string {
    return createHmac('sha256', this.ipSecret)
      .update(`ip:${ip}`)
      .digest('hex')
      .slice(0, 32);
  }

  private logError(error: unknown): void {
    if (error instanceof Anthropic.APIError) {
      this.logger.error(
        `Claude API error ${error.status ?? ''} (${error.constructor.name}): ${error.message}`,
      );
    } else {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    }
  }
}
