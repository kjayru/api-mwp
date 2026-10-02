import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Home figures ("[N]+ proyectos entregados"...). */
export interface PublicStats {
  /** Non-deleted cases published in at least one locale. */
  projects: number;
  /** Distinct non-deleted technologies used by those cases. */
  technologies: number;
  /** Distinct non-empty ES industries of those cases (trimmed, case-insensitive). */
  industries: number;
}

export interface StatsCaseRow {
  translations: { industry: string | null }[];
  technologies: { technologyId: string }[];
}

export function computeStats(rows: StatsCaseRow[]): PublicStats {
  const technologies = new Set<string>();
  const industries = new Set<string>();
  for (const row of rows) {
    for (const { technologyId } of row.technologies) {
      technologies.add(technologyId);
    }
    for (const { industry } of row.translations) {
      const normalized = industry?.trim().toLocaleLowerCase('es');
      if (normalized) industries.add(normalized);
    }
  }
  return {
    projects: rows.length,
    technologies: technologies.size,
    industries: industries.size,
  };
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PublicStats> {
    const rows = await this.prisma.case.findMany({
      where: {
        deletedAt: null,
        translations: { some: { status: 'PUBLISHED' } },
      },
      select: {
        translations: { where: { locale: 'ES' }, select: { industry: true } },
        technologies: {
          where: { technology: { deletedAt: null } },
          select: { technologyId: true },
        },
      },
    });
    return computeStats(rows);
  }
}
