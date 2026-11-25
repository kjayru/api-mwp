import { Body, Controller, Get, Put } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UpdateSiteSettingsDto } from './dto/site-settings.dto.js';
import { type AdminSiteSettings, SettingsService } from './settings.service.js';

@Roles('ADMIN', 'EDITOR')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(): Promise<AdminSiteSettings> {
    return this.settings.getAdmin();
  }

  /** Replaces the whole configuration. ADMIN only. */
  @Roles('ADMIN')
  @Put()
  update(@Body() dto: UpdateSiteSettingsDto): Promise<AdminSiteSettings> {
    return this.settings.update(dto);
  }
}
