import { Module } from '@nestjs/common';
import { AdminConversationsController } from './admin-conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

/** Chat conversations and messages (stored by the assistant, read by the admin). */
@Module({
  controllers: [AdminConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
