import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  type KnowledgeStatus,
  KnowledgeStatusService,
} from './knowledge-status.service.js';
import { KnowledgeSyncService } from './knowledge-sync.service.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/knowledge')
export class AdminKnowledgeController {
  constructor(
    private readonly statusService: KnowledgeStatusService,
    private readonly sync: KnowledgeSyncService,
  ) {}

  @Get('status')
  status(): Promise<KnowledgeStatus> {
    return this.statusService.status();
  }

  /** "Reindexar ahora": 202 with the run; poll GET /status for the outcome. */
  @Post('reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  async reindex(): Promise<{ runId: string; status: 'RUNNING'; startedAt: Date }> {
    const run = await this.sync.startFullReindex();
    return { runId: run.id, status: 'RUNNING', startedAt: run.startedAt };
  }
}
