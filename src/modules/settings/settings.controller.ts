import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { PublicCache } from '../../common/interceptors/public-cache.interceptor.js';
import {
  type PublicSiteSettings,
  SettingsService,
} from './settings.service.js';

/** `GET /settings`: contact data of the public site (front fetch tag `settings`). */
@Public()
@PublicCache()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(): Promise<PublicSiteSettings> {
    return this.settings.getPublic();
  }
}
