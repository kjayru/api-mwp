import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * 400 when any of `ids` is not a non-deleted technology. Used before replacing
 * the technologies linked to a case or a service.
 */
export async function assertTechnologiesExist(
  db: Prisma.TransactionClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const found = await db.technology.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true },
  });
  const known = new Set(found.map((row) => row.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `technologyIds contiene tecnologías inexistentes o eliminadas: ${unknown.join(', ')}`,
    );
  }
}
