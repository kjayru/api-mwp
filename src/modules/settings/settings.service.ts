import { Injectable } from '@nestjs/common';
import {
  RevalidationService,
  RevalidationTag,
} from '../../common/revalidation/revalidation.service.js';
import type { Prisma, SiteSettings } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  type BusinessHours,
  DEFAULT_BUSINESS_HOURS,
} from '../calendar/business-hours.js';
import { isValidTimeZone } from '../calendar/time-zones.js';
import type { UpdateSiteSettingsDto } from './dto/site-settings.dto.js';
import {
  canonicalTimeZone,
  DAYS_IN_ORDER,
  normalizeBusinessHours,
  parseSocialLinks,
  type SocialLinks,
} from './site-settings.rules.js';

export const SITE_SETTINGS_ID = 'default';
export const DEFAULT_SITE_TIME_ZONE = 'America/Lima';
const DEFAULT_MEETING_DURATION = 30;

export interface PublicSiteSettings {
  contactEmail: string;
  whatsapp: string | null;
  socialLinks: SocialLinks;
  /** Seven keys, mon..sun (shown on /contacto). */
  businessHours: BusinessHours;
  timezone: string;
}

export interface AdminSiteSettings extends PublicSiteSettings {
  meetingDurationMinutes: number;
  /** null only while the row does not exist yet (the seed creates it). */
  updatedAt: Date | null;
}

function toView(row: SiteSettings | null): AdminSiteSettings {
  if (!row) {
    return {
      contactEmail: '',
      whatsapp: null,
      socialLinks: parseSocialLinks(null),
      businessHours: normalizeBusinessHours(DEFAULT_BUSINESS_HOURS),
      timezone: DEFAULT_SITE_TIME_ZONE,
      meetingDurationMinutes: DEFAULT_MEETING_DURATION,
      updatedAt: null,
    };
  }
  return {
    contactEmail: row.contactEmail,
    whatsapp: row.whatsapp,
    socialLinks: parseSocialLinks(row.socialLinks),
    businessHours: normalizeBusinessHours(row.businessHours),
    timezone: row.timezone,
    meetingDurationMinutes: row.meetingDurationMinutes,
    updatedAt: row.updatedAt,
  };
}

/** The SiteSettings singleton (row "default"): public contact data and studio configuration. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  async getPublic(): Promise<PublicSiteSettings> {
    const { contactEmail, whatsapp, socialLinks, businessHours, timezone } =
      await this.getAdmin();
    return { contactEmail, whatsapp, socialLinks, businessHours, timezone };
  }

  async getAdmin(): Promise<AdminSiteSettings> {
    return toView(await this.find());
  }

  /** Studio time zone (falls back to America/Lima when unset or invalid). */
  async timeZone(): Promise<string> {
    const row = await this.prisma.siteSettings.findUnique({
      where: { id: SITE_SETTINGS_ID },
      select: { timezone: true },
    });
    return row?.timezone && isValidTimeZone(row.timezone)
      ? row.timezone
      : DEFAULT_SITE_TIME_ZONE;
  }

  /** Replaces the whole row and tells the front to refetch `settings`. */
  async update(dto: UpdateSiteSettingsDto): Promise<AdminSiteSettings> {
    const businessHours = Object.fromEntries(
      DAYS_IN_ORDER.map((day) => [
        day,
        dto.businessHours[day].map(({ start, end }) => ({ start, end })),
      ]),
    );
    const data = {
      contactEmail: dto.contactEmail,
      whatsapp: dto.whatsapp,
      socialLinks: {
        linkedin: dto.socialLinks.linkedin,
        github: dto.socialLinks.github,
        instagram: dto.socialLinks.instagram,
      } as Prisma.InputJsonValue,
      businessHours: businessHours as Prisma.InputJsonValue,
      timezone: canonicalTimeZone(dto.timezone),
      meetingDurationMinutes: dto.meetingDurationMinutes,
    };
    const row = await this.prisma.siteSettings.upsert({
      where: { id: SITE_SETTINGS_ID },
      create: { id: SITE_SETTINGS_ID, ...data },
      update: data,
    });
    void this.revalidation.revalidate([RevalidationTag.settings]);
    return toView(row);
  }

  private find(): Promise<SiteSettings | null> {
    return this.prisma.siteSettings.findUnique({
      where: { id: SITE_SETTINGS_ID },
    });
  }
}
