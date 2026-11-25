import { Controller, Get, Param, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { Paginated } from '../../common/pagination/pagination.js';
import {
  type AdminConversationDetail,
  type AdminConversationListItem,
  ConversationsService,
} from './conversations.service.js';
import { AdminConversationsQueryDto } from './dto/conversations-query.dto.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/conversations')
export class AdminConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(
    @Query() query: AdminConversationsQueryDto,
  ): Promise<Paginated<AdminConversationListItem>> {
    return this.conversations.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<AdminConversationDetail> {
    return this.conversations.detail(id);
  }
}
