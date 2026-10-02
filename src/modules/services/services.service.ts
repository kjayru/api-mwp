import { Injectable } from '@nestjs/common';
import { type PublicLocale, toDbLocale } from '../../common/i18n/locale.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { PublicService } from './entities/service.entity.js';

/** Public services: published translations of non-deleted services. */
@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(publicLocale: PublicLocale): Promise<PublicService[]> {
    const locale = toDbLocale(publicLocale);
    const rows = await this.prisma.serviceTranslation.findMany({
      where: { locale, status: 'PUBLISHED', service: { deletedAt: null } },
      orderBy: [
        { service: { sortOrder: 'asc' } },
        { service: { createdAt: 'asc' } },
        { serviceId: 'asc' },
      ],
      select: {
        title: true,
        slug: true,
        description: true,
        service: {
          select: {
            technologies: {
              where: { technology: { deletedAt: null } },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              select: { technology: { select: { name: true, slug: true } } },
            },
          },
        },
      },
    });
    return rows.map(({ service, ...t }) => ({
      ...t,
      technologies: service.technologies.map(({ technology }) => technology),
    }));
  }
}
