import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { AssistantSettingsModule } from '../assistant-settings/assistant-settings.module.js';
import { CalendarModule } from '../calendar/calendar.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { AdminAssistantController } from './admin-assistant.controller.js';
import { AssistantUsageService } from './assistant-usage.service.js';
import { AssistantEngineService } from './assistant-engine.service.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { AnthropicModelClient, MODEL_CLIENT } from './model-client.js';
import { AssistantToolsService } from './tools/assistant-tools.service.js';

/** AI assistant: public SSE chat, tools, admin settings and test endpoint. */
@Module({
  imports: [
    AssistantSettingsModule,
    ConversationsModule,
    LeadsModule,
    CalendarModule,
  ],
  controllers: [AssistantController, AdminAssistantController],
  providers: [
    {
      provide: MODEL_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new AnthropicModelClient(config.get('ANTHROPIC_API_KEY', { infer: true })),
    },
    AssistantEngineService,
    AssistantToolsService,
    AssistantService,
    AssistantUsageService,
  ],
})
export class AssistantModule {}
