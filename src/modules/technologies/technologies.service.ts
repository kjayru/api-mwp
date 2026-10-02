import { Injectable } from '@nestjs/common';
import { type PublicLocale, toDbLocale } from '../../common/i18n/locale.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { PublicTechnology } from './entities/technology.entity.js';

/**
 * Public technologies. They have no publish status: every non-deleted one is
 * listed, ordered by sortOrder then createdAt.
 */
@Injectable()
export class TechnologiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    publicLocale: PublicLocale,
    featured?: boolean,
  ): Promise<PublicTechnology[]> {
    const locale = toDbLocale(publicLocale);
    const rows = await this.prisma.technology.findMany({
      where: {
        deletedAt: null,
        ...(featured === undefined ? {} : { isFeatured: featured }),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        name: true,
        slug: true,
        category: true,
        isFeatured: true,
        translations: { where: { locale }, select: { description: true } },
      },
    });
    return rows.map(({ translations, ...tech }) => ({
      ...tech,
      description: translations[0]?.description?.trim() || null,
    }));
  }
}
