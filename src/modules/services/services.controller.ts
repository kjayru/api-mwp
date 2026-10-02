import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { PublicLocaleQueryDto } from '../../common/i18n/locale.js';
import { PublicCache } from '../../common/interceptors/public-cache.interceptor.js';
import type { ListResponse } from '../../common/pagination/pagination.js';
import type { PublicService } from './entities/service.entity.js';
import { ServicesService } from './services.service.js';

@Public()
@PublicCache()
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  async list(
    @Query() query: PublicLocaleQueryDto,
  ): Promise<ListResponse<PublicService>> {
    return { data: await this.services.list(query.locale) };
  }
}
