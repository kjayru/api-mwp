import { Module } from '@nestjs/common';
import { AdminFaqsController } from './admin-faqs.controller.js';
import { AdminFaqsService } from './admin-faqs.service.js';

/** FAQs of the assistant's knowledge base (admin only; no public page yet). */
@Module({
  controllers: [AdminFaqsController],
  providers: [AdminFaqsService],
})
export class FaqsModule {}
