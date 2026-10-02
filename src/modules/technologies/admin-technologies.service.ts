import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LOCALES } from '../../common/i18n/locale.js';
import { rethrowUniqueAsConflict } from '../../common/prisma-errors.js';
import { assertIsPermutation } from '../../common/reorder.js';
import {
  RevalidationService,
  RevalidationTag,
} from '../../common/revalidation/revalidation.service.js';
import { slugify, uniqueSlug } from '../../common/slug.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  CreateTechnologyDto,
  TechnologyDescriptionsDto,
  UpdateTechnologyDto,
} from './dto/technology.dto.js';
import type { AdminTechnology } from './entities/technology.entity.js';

type Tx = Prisma.TransactionClient;

export const TECHNOLOGY_NOT_FOUND = 'Tecnología no encontrada';

const ADMIN_SELECT = {
  id: true,
  name: true,
  slug: true,
  category: true,
  isFeatured: true,
  sortOrder: true,
  translations: { select: { locale: true, description: true } },
  _count: {
    select: {
      cases: { where: { case: { deletedAt: null } } },
      services: { where: { service: { deletedAt: null } } },
    },
  },
} satisfies Prisma.TechnologySelect;

type AdminRow = Prisma.TechnologyGetPayload<{ select: typeof ADMIN_SELECT }>;

function toAdminTechnology(row: AdminRow): AdminTechnology {
  const description = (locale: 'ES' | 'EN') =>
    row.translations.find((t) => t.locale === locale)?.description ?? null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    isFeatured: row.isFeatured,
    sortOrder: row.sortOrder,
    descriptions: { ES: description('ES'), EN: description('EN') },
    usage: { cases: row._count.cases, services: row._count.services },
  };
}

/** Admin CRUD of technologies. Deleting is soft and allowed while in use. */
@Injectable()
export class AdminTechnologiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  async list(): Promise<AdminTechnology[]> {
    const rows = await this.prisma.technology.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: ADMIN_SELECT,
    });
    return rows.map(toAdminTechnology);
  }

  async findOne(id: string): Promise<AdminTechnology> {
    const row = await this.prisma.technology.findFirst({
      where: { id, deletedAt: null },
      select: ADMIN_SELECT,
    });
    if (!row) {
      throw new NotFoundException(TECHNOLOGY_NOT_FOUND);
    }
    return toAdminTechnology(row);
  }

  async create(dto: CreateTechnologyDto): Promise<AdminTechnology> {
    const id = await this.prisma
      .$transaction(async (tx) => {
        await this.assertNameAvailable(tx, dto.name);
        const slug = dto.slug
          ? await this.assertSlugAvailable(tx, dto.slug)
          : await uniqueSlug(
              slugify(dto.name) || 'tecnologia',
              async (candidate) =>
                (await tx.technology.count({ where: { slug: candidate } })) > 0,
            );
        const { _max } = await tx.technology.aggregate({
          where: { deletedAt: null },
          _max: { sortOrder: true },
        });
        const created = await tx.technology.create({
          data: {
            name: dto.name,
            slug,
            category: dto.category,
            isFeatured: dto.isFeatured,
            sortOrder: (_max.sortOrder ?? 0) + 1,
          },
          select: { id: true },
        });
        await this.saveDescriptions(tx, created.id, dto.descriptions);
        return created.id;
      })
      .catch(rethrowUniqueAsConflict);

    void this.revalidation.revalidate([RevalidationTag.technologies]);
    return this.findOne(id);
  }

  async update(id: string, dto: UpdateTechnologyDto): Promise<AdminTechnology> {
    await this.prisma
      .$transaction(async (tx) => {
        const current = await tx.technology.findFirst({
          where: { id, deletedAt: null },
          select: { name: true, slug: true },
        });
        if (!current) {
          throw new NotFoundException(TECHNOLOGY_NOT_FOUND);
        }
        if (dto.name !== undefined && dto.name !== current.name) {
          await this.assertNameAvailable(tx, dto.name, id);
        }
        if (dto.slug !== undefined && dto.slug !== current.slug) {
          await this.assertSlugAvailable(tx, dto.slug);
        }
        await tx.technology.update({
          where: { id },
          data: {
            name: dto.name,
            slug: dto.slug,
            category: dto.category,
            isFeatured: dto.isFeatured,
            sortOrder: dto.sortOrder,
            updatedAt: new Date(),
          },
        });
        await this.saveDescriptions(tx, id, dto.descriptions);
      })
      .catch(rethrowUniqueAsConflict);

    this.notifyUsedEverywhere();
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const { count } = await this.prisma.technology.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException(TECHNOLOGY_NOT_FOUND);
    }
    this.notifyUsedEverywhere();
  }

  async reorder(ids: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.technology.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      assertIsPermutation(
        ids,
        existing.map((row) => row.id),
      );
      for (const [index, id] of ids.entries()) {
        // Only rows whose position changes are written, so updatedAt stays put
        // for the rest.
        await tx.technology.updateMany({
          where: { id, NOT: { sortOrder: index + 1 } },
          data: { sortOrder: index + 1 },
        });
      }
    });
    void this.revalidation.revalidate([RevalidationTag.technologies]);
  }

  /** Name and slug show up in case and service chips and in the stats. */
  private notifyUsedEverywhere(): void {
    void this.revalidation.revalidate([
      RevalidationTag.technologies,
      RevalidationTag.cases,
      RevalidationTag.services,
      RevalidationTag.stats,
    ]);
  }

  private async saveDescriptions(
    tx: Tx,
    technologyId: string,
    descriptions: TechnologyDescriptionsDto | undefined,
  ): Promise<void> {
    if (!descriptions) return;
    for (const locale of LOCALES) {
      const value = descriptions[locale];
      if (value === undefined) continue;
      const description = value === null || value === '' ? null : value;
      await tx.technologyTranslation.upsert({
        where: { technologyId_locale: { technologyId, locale } },
        create: { technologyId, locale, description },
        update: { description },
      });
    }
  }

  /** Names are unique regardless of case (".NET Core" vs ".net core"). */
  private async assertNameAvailable(
    tx: Tx,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const owner = await tx.technology.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { name: true, deletedAt: true },
    });
    if (owner) {
      throw new ConflictException(
        owner.deletedAt
          ? `Ya existe una tecnología eliminada llamada "${owner.name}"`
          : `Ya existe una tecnología llamada "${owner.name}"`,
      );
    }
  }

  private async assertSlugAvailable(tx: Tx, slug: string): Promise<string> {
    const owner = await tx.technology.findUnique({
      where: { slug },
      select: { deletedAt: true },
    });
    if (owner) {
      throw new ConflictException(
        owner.deletedAt
          ? `El slug "${slug}" lo usa una tecnología eliminada; elige otro`
          : `El slug "${slug}" ya está en uso en otra tecnología`,
      );
    }
    return slug;
  }
}
