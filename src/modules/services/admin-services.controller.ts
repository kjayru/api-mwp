import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { LocaleBodyDto } from '../../common/i18n/locale.js';
import type { ListResponse } from '../../common/pagination/pagination.js';
import { ReorderDto } from '../../common/reorder.js';
import { AdminServicesService } from './admin-services.service.js';
import { CreateServiceDto, UpdateServiceDto } from './dto/service.dto.js';
import type { AdminService } from './entities/service.entity.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/services')
export class AdminServicesController {
  constructor(private readonly services: AdminServicesService) {}

  @Get()
  async list(): Promise<ListResponse<AdminService>> {
    return { data: await this.services.list() };
  }

  @Put('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(@Body() dto: ReorderDto): Promise<void> {
    return this.services.reorder(dto.ids);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<AdminService> {
    return this.services.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateServiceDto): Promise<AdminService> {
    return this.services.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ): Promise<AdminService> {
    return this.services.update(id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id') id: string,
    @Body() dto: LocaleBodyDto,
  ): Promise<AdminService> {
    return this.services.publish(id, dto.locale);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @Param('id') id: string,
    @Body() dto: LocaleBodyDto,
  ): Promise<AdminService> {
    return this.services.unpublish(id, dto.locale);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.services.remove(id);
  }
}
