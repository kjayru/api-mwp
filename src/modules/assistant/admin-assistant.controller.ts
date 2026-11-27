import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  AssistantSettingsService,
  type AssistantSettingsView,
  UpdateAssistantSettingsDto,
} from '../assistant-settings/assistant-settings.service.js';
import {
  ConversationsService,
  type UnansweredQuestion,
} from '../conversations/conversations.service.js';
import { DaysQueryDto } from '../conversations/dto/conversations-query.dto.js';
import {
  type AssistantUsage,
  AssistantUsageService,
  DEFAULT_USAGE_DAYS,
} from './assistant-usage.service.js';
import {
  type AssistantTestResult,
  AssistantService,
} from './assistant.service.js';
import { AssistantTestDto } from './dto/chat.dto.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/assistant')
export class AdminAssistantController {
  constructor(
    private readonly settings: AssistantSettingsService,
    private readonly assistant: AssistantService,
    private readonly conversations: ConversationsService,
    private readonly usageService: AssistantUsageService,
  ) {}

  @Get('settings')
  getSettings(): Promise<AssistantSettingsView> {
    return this.settings.get();
  }

  @Put('settings')
  updateSettings(
    @Body() dto: UpdateAssistantSettingsDto,
  ): Promise<AssistantSettingsView> {
    return this.settings.update(dto);
  }

  /** "Probar pregunta sobre este caso": JSON answer, nothing stored. */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  test(@Body() dto: AssistantTestDto): Promise<AssistantTestResult> {
    return this.assistant.test(dto);
  }

  /** Token usage and estimated cost of the stored assistant answers. */
  @Get('usage')
  usage(@Query() query: DaysQueryDto): Promise<AssistantUsage> {
    return this.usageService.usage(query.days ?? DEFAULT_USAGE_DAYS);
  }

  /** "Crear FAQ" banner and dashboard: questions without an answer. */
  @Get('unanswered')
  unanswered(
    @Query() query: DaysQueryDto,
  ): Promise<{ days: number; count: number; questions: UnansweredQuestion[] }> {
    return this.conversations.unanswered(query.days ?? 7);
  }
}
