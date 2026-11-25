import { Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/** Site settings (SiteSettings singleton, docs/API.md 11.5). */
@Module({
  controllers: [SettingsController, AdminSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
