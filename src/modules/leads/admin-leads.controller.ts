import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { AdminLeadsQueryDto, UpdateLeadDto } from './dto/admin-leads.dto.js';
import {
  type AdminLeadDetail,
  type AdminLeadsPage,
  LeadsService,
} from './leads.service.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/leads')
export class AdminLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(@Query() query: AdminLeadsQueryDto): Promise<AdminLeadsPage> {
    return this.leads.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<AdminLeadDetail> {
    return this.leads.detail(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ): Promise<AdminLeadDetail> {
    return this.leads.update(id, dto);
  }

  /** Soft delete, ADMIN only. */
  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.leads.remove(id);
  }
}
