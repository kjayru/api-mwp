import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { DaysQueryDto } from '../conversations/dto/conversations-query.dto.js';
import {
  AdminStatsService,
  DEFAULT_OVERVIEW_DAYS,
  type StatsOverview,
} from './admin-stats.service.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/stats')
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  /** Dashboard: KPIs, daily series, top questions and latest leads. */
  @Get('overview')
  overview(@Query() query: DaysQueryDto): Promise<StatsOverview> {
    return this.stats.overview(query.days ?? DEFAULT_OVERVIEW_DAYS);
  }
}
