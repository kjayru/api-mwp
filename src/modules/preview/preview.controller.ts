import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { PublicLocaleQueryDto } from '../../common/i18n/locale.js';
import type { PublicBlogPostDetail } from '../blog/entities/blog.entity.js';
import type { PublicCaseDetail } from '../cases/entities/public-case.entity.js';
import { CreatePreviewDto, ResolvePreviewDto } from './dto/preview.dto.js';
import { PreviewSecretGuard } from './preview-secret.guard.js';
import {
  type PreviewLink,
  PreviewService,
  type ResolvedPreview,
} from './preview.service.js';

/** The admin asks for a preview link of a case or post. */
@Roles('ADMIN', 'EDITOR')
@Controller('admin/preview')
export class AdminPreviewController {
  constructor(private readonly preview: PreviewService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreatePreviewDto): Promise<PreviewLink> {
    return this.preview.createLink(dto);
  }
}

/** Called by front-mwp (server side) in draft mode, with `x-preview-secret`. */
@Public()
@UseGuards(PreviewSecretGuard)
@Controller('preview')
export class PreviewController {
  constructor(private readonly preview: PreviewService) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  resolve(@Body() dto: ResolvePreviewDto): Promise<ResolvedPreview> {
    return this.preview.resolve(dto.token);
  }

  @Get('cases/:slug')
  @Header('Cache-Control', 'no-store')
  caseBySlug(
    @Param('slug') slug: string,
    @Query() query: PublicLocaleQueryDto,
  ): Promise<PublicCaseDetail> {
    return this.preview.caseBySlug(query.locale, slug);
  }

  @Get('blog/:slug')
  @Header('Cache-Control', 'no-store')
  postBySlug(
    @Param('slug') slug: string,
    @Query() query: PublicLocaleQueryDto,
  ): Promise<PublicBlogPostDetail> {
    return this.preview.postBySlug(query.locale, slug);
  }
}
