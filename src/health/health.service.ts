import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface DatabaseHealth {
  database: 'up' | 'down';
  pgvector: boolean;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkDatabase(): Promise<DatabaseHealth> {
    try {
      const [row] = await this.prisma.$queryRaw<{ pgvector: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS pgvector
      `;
      return { database: 'up', pgvector: row?.pgvector ?? false };
    } catch (error) {
      this.logger.warn(
        `Database health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { database: 'down', pgvector: false };
    }
  }
}
