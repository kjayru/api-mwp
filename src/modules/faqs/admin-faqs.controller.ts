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
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { LocaleBodyDto } from '../../common/i18n/locale.js';
import type { Paginated } from '../../common/pagination/pagination.js';
import { ReorderDto } from '../../common/reorder.js';
import { type AdminFaq, AdminFaqsService } from './admin-faqs.service.js';
import { AdminFaqsQueryDto, CreateFaqDto, UpdateFaqDto } from './dto/faq.dto.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/faqs')
export class AdminFaqsController {
  constructor(private readonly faqs: AdminFaqsService) {}

  @Get()
  list(@Query() query: AdminFaqsQueryDto): Promise<Paginated<AdminFaq>> {
    return this.faqs.list(query);
  }

  @Put('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(@Body() dto: ReorderDto): Promise<void> {
    return this.faqs.reorder(dto.ids);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<AdminFaq> {
    return this.faqs.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateFaqDto): Promise<AdminFaq> {
    return this.faqs.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFaqDto): Promise<AdminFaq> {
    return this.faqs.update(id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id') id: string,
    @Body() dto: LocaleBodyDto,
  ): Promise<AdminFaq> {
    return this.faqs.publish(id, dto.locale);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @Param('id') id: string,
    @Body() dto: LocaleBodyDto,
  ): Promise<AdminFaq> {
    return this.faqs.unpublish(id, dto.locale);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.faqs.remove(id);
  }
}
