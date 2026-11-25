import { Module } from '@nestjs/common';
import { AssistantSettingsService } from './assistant-settings.service.js';

/** Assistant configuration edited in the admin (routes in AdminAssistantController). */
@Module({
  providers: [AssistantSettingsService],
  exports: [AssistantSettingsService],
})
export class AssistantSettingsModule {}
