import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { PublicCache } from '../../common/interceptors/public-cache.interceptor.js';
import { type PublicStats, StatsService } from './stats.service.js';

@Public()
@PublicCache()
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  get(): Promise<PublicStats> {
    return this.stats.get();
  }
}
