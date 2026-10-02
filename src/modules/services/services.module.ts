import { Module } from '@nestjs/common';
import { AdminServicesController } from './admin-services.controller.js';
import { AdminServicesService } from './admin-services.service.js';
import { ServicesController } from './services.controller.js';
import { ServicesService } from './services.service.js';

/** "Services" = what the studio offers (Home accordion and /servicios). */
@Module({
  controllers: [ServicesController, AdminServicesController],
  providers: [ServicesService, AdminServicesService],
})
export class ServicesModule {}
