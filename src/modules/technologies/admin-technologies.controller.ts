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
import type { ListResponse } from '../../common/pagination/pagination.js';
import { ReorderDto } from '../../common/reorder.js';
import { AdminTechnologiesService } from './admin-technologies.service.js';
import {
  CreateTechnologyDto,
  UpdateTechnologyDto,
} from './dto/technology.dto.js';
import type { AdminTechnology } from './entities/technology.entity.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/technologies')
export class AdminTechnologiesController {
  constructor(private readonly technologies: AdminTechnologiesService) {}

  @Get()
  async list(): Promise<ListResponse<AdminTechnology>> {
    return { data: await this.technologies.list() };
  }

  @Put('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(@Body() dto: ReorderDto): Promise<void> {
    return this.technologies.reorder(dto.ids);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<AdminTechnology> {
    return this.technologies.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTechnologyDto): Promise<AdminTechnology> {
    return this.technologies.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTechnologyDto,
  ): Promise<AdminTechnology> {
    return this.technologies.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.technologies.remove(id);
  }
}
