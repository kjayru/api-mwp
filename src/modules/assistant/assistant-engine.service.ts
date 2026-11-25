import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Locale } from '../../generated/prisma/enums.js';
import type { AssistantToolName } from '../assistant-settings/assistant-settings.constants.js';
import type { AssistantSettingsView } from '../assistant-settings/assistant-settings.service.js';
import type { KnowledgeHit } from '../knowledge/knowledge-search.service.js';
import { CitationStreamFilter } from './citations.js';
import {
  MODEL_CLIENT,
  type ModelClient,
  type ModelMessage,
  type ModelRequest,
} from './model-client.js';
import { buildModelRequest, buildSystemPrompt } from './prompt.js';
import {
  AssistantToolsService,
  type ToolCallRecord,
  type ToolContext,
  type ToolEvents,
} from './tools/assistant-tools.service.js';
import { toolsFor } from './tools/tool-definitions.js';

/** Tool rounds per turn; the next call must answer without tools. */
export const MAX_TOOL_ROUNDS = 4;
/** Re-issues of a call whose streamed tool input could not be parsed. */
const MAX_JSON_RETRIES = 2;
/** Sources shown when the model answered from the search without citing. */
const MAX_FALLBACK_SOURCES = 3;

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

export interface CitedSource {
  sourceKey: string;
  title: string;
  /** Public path ("/es/casos/<slug>"); null for FAQs. */
  url: string | null;
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** Model calls made in the turn (1 + tool rounds). */
  requests: number;
}

export type TurnStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'refusal'
  | 'tool_limit'
  | 'aborted'
  | 'stop_sequence'
  | 'pause_turn'
  | 'model_context_window_exceeded';

export interface EngineSink extends ToolEvents {
  delta?(text: string): void;
  tool?(payload: {
    name: string;
    status: 'started' | 'completed' | 'failed';
  }): void;
}

export interface EngineInput {
  settings: AssistantSettingsView;
  tools: readonly AssistantToolName[];
  /** History plus the new user message (last). */
  messages: MessageParam[];
  context: ToolContext;
  signal?: AbortSignal;
}

export interface EngineResult {
  /** Final text shown to the visitor (no citation markers). */
  text: string;
  sources: CitedSource[];
  toolCalls: ToolCallRecord[];
  usage: TurnUsage;
  /** Model that produced the answer (a fallback model after a refusal). */
  model: string;
  stopReason: TurnStopReason;
  /** buscar_casos ran and never found anything relevant. */
  unanswered: boolean;
}

const COPY = {
  ES: {
    refusal:
      'Lo siento, no puedo ayudarte con esa consulta. Si quieres, puedo ponerte en contacto con el equipo.',
    incomplete:
      'Lo siento, no pude completar la respuesta. ¿Puedes reformular tu pregunta?',
  },
  EN: {
    refusal:
      "Sorry, I can't help with that request. If you like, I can put you in touch with the team.",
    incomplete:
      "Sorry, I couldn't finish the answer. Could you rephrase your question?",
  },
} as const;

export function friendlyMessage(
  locale: Locale,
  kind: keyof (typeof COPY)['ES'],
): string {
  return COPY[locale][kind];
}

/**
 * Assistant content to send back on the next call. After a mid-output
 * fallback, thinking and tool_use blocks before the last fallback marker are
 * dropped (they belong to the model that declined); the marker itself too.
 */
export function echoableContent(content: ContentBlock[]): ContentBlockParam[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback');
  const dropBefore = new Set([
    'thinking',
    'redacted_thinking',
    'tool_use',
    'server_tool_use',
  ]);
  return content.filter(
    (block, index) =>
      block.type !== 'fallback' &&
      !(index < lastFallback && dropBefore.has(block.type)),
  ) as ContentBlockParam[];
}

/** Cited sources (in citation order, one per case or FAQ), from this turn's hits. */
export function citedSources(
  cited: string[],
  hits: Map<string, KnowledgeHit>,
  fallbackToHits: boolean,
): CitedSource[] {
  const seen = new Set<string>();
  const result: CitedSource[] = [];
  const add = (hit: KnowledgeHit) => {
    const key = `${hit.sourceType}|${hit.sourceId}|${hit.locale}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ sourceKey: hit.sourceKey, title: hit.title, url: hit.url });
  };
  for (const key of cited) {
    const hit = hits.get(key);
    if (hit) add(hit);
  }
  if (result.length === 0 && fallbackToHits) {
    const ranked = [...hits.values()].sort((a, b) => b.score - a.score);
    for (const hit of ranked) {
      if (result.length >= MAX_FALLBACK_SOURCES) break;
      add(hit);
    }
  }
  return result;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || error instanceof Anthropic.APIUserAbortError;
}

/**
 * One assistant turn: streams the model's answer, runs the tools it asks for
 * (in parallel, results in a single user message), and loops until it
 * answers or MAX_TOOL_ROUNDS is reached. Throws on API errors (the caller
 * reports them); returns with stopReason "aborted" if the client went away.
 */
@Injectable()
export class AssistantEngineService {
  private readonly logger = new Logger(AssistantEngineService.name);

  constructor(
    @Inject(MODEL_CLIENT) private readonly client: ModelClient,
    private readonly tools: AssistantToolsService,
  ) {}

  get configured(): boolean {
    return this.client.configured;
  }

  async run(input: EngineInput, sink: EngineSink = {}): Promise<EngineResult> {
    const { settings, context, signal } = input;
    const system = buildSystemPrompt(settings.instructions);
    const tools = toolsFor(input.tools);
    const messages: MessageParam[] = [...input.messages];
    const usage: TurnUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      requests: 0,
    };
    const toolCalls: ToolCallRecord[] = [];
    const hits = new Map<string, KnowledgeHit>();
    const filter = new CitationStreamFilter();
    let text = '';
    let searched = false;
    let model: string = settings.model;
    let stopReason: TurnStopReason = 'end_turn';
    let jsonRetries = 0;

    const emit = (chunk: string) => {
      if (!chunk) return;
      text += chunk;
      sink.delta?.(chunk);
    };

    // Tool rounds done so far (a re-issued call does not count).
    let round = 0;
    for (;;) {
      const noMoreTools = round >= MAX_TOOL_ROUNDS;
      const request: ModelRequest = buildModelRequest({
        model: settings.model,
        effort: settings.effort,
        system,
        tools,
        messages,
        noMoreTools,
      });
      // Text of separate model calls ("Let me check..." + the answer) is
      // separated by a blank line.
      let separate = text.length > 0;
      let message: ModelMessage;
      try {
        const stream = this.client.stream(request, { signal });
        stream.on('text', (delta) => {
          let clean = filter.push(delta);
          if (separate) {
            clean = clean.replace(/^\s+/, '');
            if (!clean) return;
            clean = `\n\n${clean}`;
            separate = false;
          }
          emit(clean);
        });
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (error) {
        if (isAbort(error, signal)) {
          stopReason = 'aborted';
          break;
        }
        if (error instanceof Anthropic.APIError || jsonRetries >= MAX_JSON_RETRIES) {
          throw error;
        }
        // With eager input streaming, a tool input that is not valid JSON
        // rejects finalMessage(): re-issue the same call.
        jsonRetries++;
        this.logger.warn(
          `Unparseable streamed tool input, re-issuing (${jsonRetries}/${MAX_JSON_RETRIES})`,
        );
        continue;
      }

      usage.requests++;
      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
      usage.cacheReadInputTokens += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheCreationInputTokens +=
        message.usage.cache_creation_input_tokens ?? 0;
      model = message.model;

      const reason = message.stop_reason;
      if (reason === 'refusal') {
        // The whole fallback chain declined. Never run this turn's tools.
        stopReason = 'refusal';
        break;
      }
      const toolUses = message.content.filter(
        (block): block is ToolUse => block.type === 'tool_use',
      );
      if (reason === 'max_tokens') {
        // A truncated tool input may still parse: never run it.
        stopReason = 'max_tokens';
        break;
      }
      if (reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: echoableContent(message.content) });
        if (round++ < MAX_TOOL_ROUNDS) continue;
        stopReason = 'pause_turn';
        break;
      }
      if (reason !== 'tool_use' || toolUses.length === 0) {
        stopReason = (reason ?? 'end_turn') as TurnStopReason;
        break;
      }
      if (noMoreTools) {
        stopReason = 'tool_limit';
        break;
      }

      messages.push({ role: 'assistant', content: echoableContent(message.content) });
      const results = await Promise.all(
        toolUses.map(async (block): Promise<ToolResult> => {
          sink.tool?.({ name: block.name, status: 'started' });
          const execution = await this.tools.execute(block, context, sink);
          sink.tool?.({
            name: block.name,
            status: execution.isError ? 'failed' : 'completed',
          });
          toolCalls.push(execution.record);
          if (block.name === 'buscar_casos' && !execution.isError) {
            searched = true;
            for (const hit of execution.hits ?? []) hits.set(hit.sourceKey, hit);
          }
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: execution.content,
            ...(execution.isError ? { is_error: true } : {}),
          };
        }),
      );
      if (signal?.aborted) {
        stopReason = 'aborted';
        break;
      }
      messages.push({ role: 'user', content: results });
      round++;
    }

    emit(filter.end());
    const locale = context.locale;
    if (stopReason === 'refusal') {
      // Partial output of a declined answer is discarded.
      const friendly = friendlyMessage(locale, 'refusal');
      sink.delta?.(text ? `\n\n${friendly}` : friendly);
      text = friendly;
    } else if (
      (stopReason === 'max_tokens' || stopReason === 'tool_limit') &&
      !text.trim()
    ) {
      emit(friendlyMessage(locale, 'incomplete'));
    }

    const unanswered = searched && hits.size === 0;
    return {
      text: text.trim(),
      sources:
        stopReason === 'refusal'
          ? []
          : citedSources(filter.cited, hits, !unanswered && text.trim().length > 0),
      toolCalls,
      usage,
      model,
      stopReason,
      unanswered,
    };
  }
}
