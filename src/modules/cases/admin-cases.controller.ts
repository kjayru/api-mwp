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
import { AdminCasesService } from './admin-cases.service.js';
import { AdminCasesQueryDto } from './dto/admin-cases-query.dto.js';
import {
  CreateCaseImageDto,
  UpdateCaseImageDto,
} from './dto/case-image.dto.js';
import { CreateCaseDto } from './dto/create-case.dto.js';
import { UpdateCaseDto } from './dto/update-case.dto.js';
import type {
  AdminCase,
  AdminCaseImage,
  AdminCaseListItem,
} from './entities/admin-case.entity.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/cases')
export class AdminCasesController {
  constructor(private readonly cases: AdminCasesService) {}

  @Get()
  list(
    @Query() query: AdminCasesQueryDto,
  ): Promise<Paginated<AdminCaseListItem>> {
    return this.cases.list(query);
  }

  @Put('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(@Body() dto: ReorderDto): Promise<void> {
    return this.cases.reorder(dto.ids);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<AdminCase> {
    return this.cases.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCaseDto): Promise<AdminCase> {
    return this.cases.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCaseDto,
  ): Promise<AdminCase> {
    return this.cases.update(id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id') id: string,
    @Body() dto: LocaleBodyDto,
  ): Promise<AdminCase> {
    return this.cases.publish(id, dto.locale);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @Param('id') id: string,
    @Body() dto: LocaleBodyDto,
  ): Promise<AdminCase> {
    return this.cases.unpublish(id, dto.locale);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.cases.remove(id);
  }

  @Post(':id/images')
  addImage(
    @Param('id') id: string,
    @Body() dto: CreateCaseImageDto,
  ): Promise<AdminCaseImage> {
    return this.cases.addImage(id, dto);
  }

  @Patch(':id/images/:imageId')
  updateImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Body() dto: UpdateCaseImageDto,
  ): Promise<AdminCaseImage> {
    return this.cases.updateImage(id, imageId, dto);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ): Promise<void> {
    return this.cases.removeImage(id, imageId);
  }
}
