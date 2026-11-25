import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

/** Page views of the public site (POST /track). Read by the dashboard. */
@Module({
  imports: [SettingsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
