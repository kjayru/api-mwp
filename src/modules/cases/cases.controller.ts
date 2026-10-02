import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { PublicLocaleQueryDto } from '../../common/i18n/locale.js';
import { PublicCache } from '../../common/interceptors/public-cache.interceptor.js';
import type { ListResponse } from '../../common/pagination/pagination.js';
import { CasesService } from './cases.service.js';
import { PublicCasesQueryDto } from './dto/public-cases-query.dto.js';
import type {
  PublicCaseDetail,
  PublicCaseListItem,
} from './entities/public-case.entity.js';

/** Public site: published cases only. */
@Public()
@PublicCache()
@Controller('cases')
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  async list(
    @Query() query: PublicCasesQueryDto,
  ): Promise<ListResponse<PublicCaseListItem>> {
    return { data: await this.casesService.list(query.locale, query.type) };
  }

  @Get(':slug')
  findOne(
    @Param('slug') slug: string,
    @Query() query: PublicLocaleQueryDto,
  ): Promise<PublicCaseDetail> {
    return this.casesService.findBySlug(query.locale, slug);
  }
}
