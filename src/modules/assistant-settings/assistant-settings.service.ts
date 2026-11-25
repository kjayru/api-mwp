import { Injectable } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../common/validation/transforms.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  ASSISTANT_EFFORTS,
  ASSISTANT_MODELS,
  ASSISTANT_TOOLS,
  type AssistantEffort,
  type AssistantModel,
  type AssistantToolName,
  DEFAULT_ASSISTANT_EFFORT,
  DEFAULT_ASSISTANT_INSTRUCTIONS,
  DEFAULT_ASSISTANT_MODEL,
  DEFAULT_MAX_MESSAGES_PER_SESSION,
  INSTRUCTIONS_MAX_LENGTH,
  MAX_MESSAGES_PER_SESSION_MAX,
  MAX_MESSAGES_PER_SESSION_MIN,
} from './assistant-settings.constants.js';

export const SETTINGS_ID = 'default';

export interface AssistantSettingsView {
  model: AssistantModel;
  effort: AssistantEffort;
  instructions: string;
  /** Subset of ASSISTANT_TOOLS, in that order. */
  enabledTools: AssistantToolName[];
  maxMessagesPerSession: number;
  updatedAt: Date;
}

/** `PUT /admin/assistant/settings`: the whole configuration. */
export class UpdateAssistantSettingsDto {
  @IsIn(ASSISTANT_MODELS, {
    message: `model debe ser uno de: ${ASSISTANT_MODELS.join(', ')}`,
  })
  model: AssistantModel;

  @IsIn(ASSISTANT_EFFORTS, {
    message: 'effort debe ser "low", "medium" o "high"',
  })
  effort: AssistantEffort;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'instructions no debe estar vacío' })
  @MaxLength(INSTRUCTIONS_MAX_LENGTH)
  instructions: string;

  @IsArray()
  @ArrayMaxSize(ASSISTANT_TOOLS.length)
  @ArrayUnique({ message: 'enabledTools no debe tener valores repetidos' })
  @IsIn(ASSISTANT_TOOLS, {
    each: true,
    message: `enabledTools solo admite: ${ASSISTANT_TOOLS.join(', ')}`,
  })
  enabledTools: AssistantToolName[];

  @IsInt()
  @Min(MAX_MESSAGES_PER_SESSION_MIN)
  @Max(MAX_MESSAGES_PER_SESSION_MAX)
  maxMessagesPerSession: number;
}

const DEFAULTS = {
  model: DEFAULT_ASSISTANT_MODEL,
  effort: DEFAULT_ASSISTANT_EFFORT,
  instructions: DEFAULT_ASSISTANT_INSTRUCTIONS,
  enabledTools: [...ASSISTANT_TOOLS],
  maxMessagesPerSession: DEFAULT_MAX_MESSAGES_PER_SESSION,
};

function narrow<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Singleton configuration of the assistant ("default" row, created on first read). */
@Injectable()
export class AssistantSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AssistantSettingsView> {
    const row = await this.prisma.assistantSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...DEFAULTS },
      update: {},
    });
    return {
      model: narrow(row.model, ASSISTANT_MODELS, DEFAULT_ASSISTANT_MODEL),
      effort: narrow(row.effort, ASSISTANT_EFFORTS, DEFAULT_ASSISTANT_EFFORT),
      instructions: row.instructions,
      // Fixed order (tools render first in the prompt: a stable order keeps the cache).
      enabledTools: ASSISTANT_TOOLS.filter((tool) =>
        row.enabledTools.includes(tool),
      ),
      maxMessagesPerSession: row.maxMessagesPerSession,
      updatedAt: row.updatedAt,
    };
  }

  async update(dto: UpdateAssistantSettingsDto): Promise<AssistantSettingsView> {
    const data = {
      model: dto.model,
      effort: dto.effort,
      instructions: dto.instructions,
      enabledTools: ASSISTANT_TOOLS.filter((tool) =>
        dto.enabledTools.includes(tool),
      ),
      maxMessagesPerSession: dto.maxMessagesPerSession,
    };
    await this.prisma.assistantSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    return this.get();
  }
}
