import { Module } from '@nestjs/common';
import { AdminCasesController } from './admin-cases.controller.js';
import { AdminCasesService } from './admin-cases.service.js';
import { CasesController } from './cases.controller.js';
import { CasesService } from './cases.service.js';

@Module({
  controllers: [CasesController, AdminCasesController],
  providers: [CasesService, AdminCasesService],
})
export class CasesModule {}
