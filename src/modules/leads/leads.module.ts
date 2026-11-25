import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminLeadsController } from './admin-leads.controller.js';
import { ChatLeadsService } from './chat-leads.service.js';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

/** Leads: public contact form, chat leads (assistant) and the admin. */
@Module({
  imports: [NotificationsModule],
  controllers: [LeadsController, AdminLeadsController],
  providers: [LeadsService, ChatLeadsService],
  exports: [ChatLeadsService, LeadsService],
})
export class LeadsModule {}
