import { Module } from '@nestjs/common';
import { AdminStatsController } from './admin-stats.controller.js';
import { AdminStatsService } from './admin-stats.service.js';
import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';

@Module({
  controllers: [StatsController, AdminStatsController],
  providers: [StatsService, AdminStatsService],
})
export class StatsModule {}
