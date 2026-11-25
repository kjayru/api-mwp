import { Module } from '@nestjs/common';
import { ChatLeadsService } from './chat-leads.service.js';

/** Leads. Phase 4 only creates them from the chat; the admin CRUD arrives in Phase 5. */
@Module({
  providers: [ChatLeadsService],
  exports: [ChatLeadsService],
})
export class LeadsModule {}
