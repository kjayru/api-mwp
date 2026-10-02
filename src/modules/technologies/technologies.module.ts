import { Module } from '@nestjs/common';
import { AdminTechnologiesController } from './admin-technologies.controller.js';
import { AdminTechnologiesService } from './admin-technologies.service.js';
import { TechnologiesController } from './technologies.controller.js';
import { TechnologiesService } from './technologies.service.js';

@Module({
  controllers: [TechnologiesController, AdminTechnologiesController],
  providers: [TechnologiesService, AdminTechnologiesService],
})
export class TechnologiesModule {}
