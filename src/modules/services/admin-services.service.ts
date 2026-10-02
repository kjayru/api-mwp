import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LOCALES } from '../../common/i18n/locale.js';
import { rethrowUniqueAsConflict } from '../../common/prisma-errors.js';
import { incompleteForPublication, isBlank } from '../../common/publication.js';
import { assertIsPermutation } from '../../common/reorder.js';
import {
  RevalidationService,
  RevalidationTag,
} from '../../common/revalidation/revalidation.service.js';
import { slugify, uniqueSlug } from '../../common/slug.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Locale } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertTechnologiesExist } from '../technologies/technology-ids.js';
import type {
  CreateServiceDto,
  ServiceTranslationDto,
  UpdateServiceDto,
} from './dto/service.dto.js';
import type {
  AdminService,
  AdminServiceTranslation,
} from './entities/service.entity.js';

type Tx = Prisma.TransactionClient;

export const SERVICE_NOT_FOUND = 'Servicio no encontrado';

export const SERVICE_PUBLISH_LABELS: Record<string, string> = {
  title: 'título',
  slug: 'slug',
  description: 'descripción',
};

/** Missing publish requirements of a service translation (empty = publishable). */
export function missingForServicePublish(
  t: { title: string; slug: string; description: string } | null,
): string[] {
  if (!t) return Object.keys(SERVICE_PUBLISH_LABELS);
  return (['title', 'slug', 'description'] as const).filter((field) =>
    isBlank(t[field]),
  );
}

const ADMIN_INCLUDE = {
  translations: true,
  technologies: {
    where: { technology: { deletedAt: null } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { technologyId: true },
  },
} satisfies Prisma.ServiceInclude;

type AdminRow = Prisma.ServiceGetPayload<{ include: typeof ADMIN_INCLUDE }>;

function toAdminService(row: AdminRow): AdminService {
  const translation = (locale: Locale): AdminServiceTranslation | null => {
    const t = row.translations.find((item) => item.locale === locale);
    return t
      ? {
          title: t.title,
          slug: t.slug,
          description: t.description,
          status: t.status,
          publishedAt: t.publishedAt,
        }
      : null;
  };
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    technologyIds: row.technologies.map((t) => t.technologyId),
    translations: { ES: translation('ES'), EN: translation('EN') },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Admin CRUD of services, their translations and order. */
@Injectable()
export class AdminServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  async list(): Promise<AdminService[]> {
    const rows = await this.prisma.service.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      include: ADMIN_INCLUDE,
    });
    return rows.map(toAdminService);
  }

  async findOne(id: string): Promise<AdminService> {
    return toAdminService(await this.load(this.prisma, id));
  }

  async create(dto: CreateServiceDto): Promise<AdminService> {
    const requested = LOCALES.filter((locale) => dto.translations[locale]);
    if (requested.length === 0) {
      throw new BadRequestException(
        'translations debe incluir al menos una versión (ES o EN) con su título',
      );
    }

    const id = await this.prisma
      .$transaction(async (tx) => {
        if (dto.technologyIds) {
          await assertTechnologiesExist(tx, dto.technologyIds);
        }
        const translations: Prisma.ServiceTranslationCreateWithoutServiceInput[] =
          [];
        for (const locale of requested) {
          const { title, slug, description } = dto.translations[locale]!;
          translations.push({
            locale,
            title,
            slug: slug
              ? await this.assertSlugAvailable(tx, locale, slug)
              : await this.generateSlug(tx, locale, title),
            description: description ?? '',
          });
        }
        const { _max } = await tx.service.aggregate({
          where: { deletedAt: null },
          _max: { sortOrder: true },
        });
        const created = await tx.service.create({
          data: {
            sortOrder: (_max.sortOrder ?? 0) + 1,
            translations: { create: translations },
            technologies: {
              create: (dto.technologyIds ?? []).map((technologyId, index) => ({
                technologyId,
                sortOrder: index + 1,
              })),
            },
          },
          select: { id: true },
        });
        return created.id;
      })
      .catch(rethrowUniqueAsConflict);

    // A new service is a draft: nothing public changes, so no revalidation.
    return this.findOne(id);
  }

  async update(id: string, dto: UpdateServiceDto): Promise<AdminService> {
    await this.prisma
      .$transaction(async (tx) => {
        const current = await this.load(tx, id);
        if (dto.technologyIds) {
          await assertTechnologiesExist(tx, dto.technologyIds);
        }
        for (const locale of LOCALES) {
          const patch = dto.translations?.[locale];
          if (patch) {
            await this.applyTranslationPatch(tx, current, locale, patch);
          }
        }
        await tx.service.update({
          where: { id },
          data: { sortOrder: dto.sortOrder, updatedAt: new Date() },
        });
        if (dto.technologyIds) {
          await tx.serviceTechnology.deleteMany({ where: { serviceId: id } });
          await tx.serviceTechnology.createMany({
            data: dto.technologyIds.map((technologyId, index) => ({
              serviceId: id,
              technologyId,
              sortOrder: index + 1,
            })),
          });
        }
      })
      .catch(rethrowUniqueAsConflict);

    this.notify();
    return this.findOne(id);
  }

  private async applyTranslationPatch(
    tx: Tx,
    current: AdminRow,
    locale: Locale,
    patch: ServiceTranslationDto,
  ): Promise<void> {
    const existing = current.translations.find((t) => t.locale === locale);
    if (!existing) {
      if (!patch.title) {
        throw new BadRequestException(
          `translations.${locale}.title es obligatorio para crear la versión ${locale}`,
        );
      }
      await tx.serviceTranslation.create({
        data: {
          serviceId: current.id,
          locale,
          title: patch.title,
          slug: patch.slug
            ? await this.assertSlugAvailable(tx, locale, patch.slug, current.id)
            : await this.generateSlug(tx, locale, patch.title),
          description: patch.description ?? '',
        },
      });
      return;
    }

    if (patch.slug !== undefined && patch.slug !== existing.slug) {
      await this.assertSlugAvailable(tx, locale, patch.slug, current.id);
    }
    if (existing.status === 'PUBLISHED') {
      const missing = missingForServicePublish({
        title: patch.title ?? existing.title,
        slug: patch.slug ?? existing.slug,
        description: patch.description ?? existing.description,
      });
      if (missing.length > 0) {
        throw incompleteForPublication(
          locale,
          missing,
          SERVICE_PUBLISH_LABELS,
          'keep-published',
        );
      }
    }
    await tx.serviceTranslation.update({
      where: { id: existing.id },
      data: {
        title: patch.title,
        slug: patch.slug,
        description: patch.description,
      },
    });
  }

  async publish(id: string, locale: Locale): Promise<AdminService> {
    const current = await this.load(this.prisma, id);
    const translation =
      current.translations.find((t) => t.locale === locale) ?? null;
    const missing = missingForServicePublish(translation);
    if (missing.length > 0 || !translation) {
      throw incompleteForPublication(
        locale,
        missing,
        SERVICE_PUBLISH_LABELS,
        'publish',
      );
    }
    await this.prisma.$transaction([
      this.prisma.serviceTranslation.update({
        where: { id: translation.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: translation.publishedAt ?? new Date(),
        },
      }),
      this.touch(id),
    ]);
    this.notify();
    return this.findOne(id);
  }

  async unpublish(id: string, locale: Locale): Promise<AdminService> {
    const current = await this.load(this.prisma, id);
    const translation = current.translations.find((t) => t.locale === locale);
    if (!translation) {
      throw new NotFoundException(`El servicio no tiene versión ${locale}`);
    }
    await this.prisma.$transaction([
      this.prisma.serviceTranslation.update({
        where: { id: translation.id },
        data: { status: 'DRAFT' },
      }),
      this.touch(id),
    ]);
    this.notify();
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const { count } = await this.prisma.service.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException(SERVICE_NOT_FOUND);
    }
    this.notify();
  }

  async reorder(ids: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.service.findMany({
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
        await tx.service.updateMany({
          where: { id, NOT: { sortOrder: index + 1 } },
          data: { sortOrder: index + 1 },
        });
      }
    });
    this.notify();
  }

  private notify(): void {
    void this.revalidation.revalidate([RevalidationTag.services]);
  }

  private async load(db: Tx, id: string): Promise<AdminRow> {
    const row = await db.service.findFirst({
      where: { id, deletedAt: null },
      include: ADMIN_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException(SERVICE_NOT_FOUND);
    }
    return row;
  }

  private touch(id: string) {
    return this.prisma.service.update({
      where: { id },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
  }

  private async assertSlugAvailable(
    tx: Tx,
    locale: Locale,
    slug: string,
    serviceId?: string,
  ): Promise<string> {
    const owner = await tx.serviceTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      select: { serviceId: true, service: { select: { deletedAt: true } } },
    });
    if (owner && owner.serviceId !== serviceId) {
      throw new ConflictException(
        owner.service.deletedAt
          ? `El slug "${slug}" (${locale}) lo usa un servicio eliminado; elige otro`
          : `El slug "${slug}" ya está en uso en otro servicio (${locale})`,
      );
    }
    return slug;
  }

  private generateSlug(tx: Tx, locale: Locale, title: string): Promise<string> {
    return uniqueSlug(
      slugify(title) || (locale === 'ES' ? 'servicio' : 'service'),
      async (candidate) =>
        (await tx.serviceTranslation.count({
          where: { locale, slug: candidate },
        })) > 0,
    );
  }
}
