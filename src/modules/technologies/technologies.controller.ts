import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { PublicCache } from '../../common/interceptors/public-cache.interceptor.js';
import type { ListResponse } from '../../common/pagination/pagination.js';
import { PublicTechnologiesQueryDto } from './dto/technology.dto.js';
import type { PublicTechnology } from './entities/technology.entity.js';
import { TechnologiesService } from './technologies.service.js';

@Public()
@PublicCache()
@Controller('technologies')
export class TechnologiesController {
  constructor(private readonly technologies: TechnologiesService) {}

  @Get()
  async list(
    @Query() query: PublicTechnologiesQueryDto,
  ): Promise<ListResponse<PublicTechnology>> {
    return {
      data: await this.technologies.list(query.locale, query.featured),
    };
  }
}
