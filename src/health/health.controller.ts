import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const { database, pgvector } = await this.healthService.checkDatabase();
    const healthy = database === 'up';
    if (!healthy) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      status: healthy ? 'ok' : 'error',
      database,
      pgvector,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
