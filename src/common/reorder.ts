import { BadRequestException } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

/** Body of `PUT /admin/<resource>/order`: every non-deleted id, in the new order. */
export class ReorderDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(64, { each: true })
  ids: string[];
}

/**
 * Checks that `ids` is a permutation of `existingIds` (no duplicates, missing or
 * unknown ids). Throws 400 with the offending ids otherwise.
 */
export function assertIsPermutation(
  ids: string[],
  existingIds: string[],
): void {
  const existing = new Set(existingIds);
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicated.add(id);
    seen.add(id);
  }
  const unknown = ids.filter((id) => !existing.has(id));
  const missing = existingIds.filter((id) => !seen.has(id));

  const problems: string[] = [];
  if (duplicated.size > 0) {
    problems.push(`ids repetidos: ${[...duplicated].join(', ')}`);
  }
  if (unknown.length > 0) {
    problems.push(`ids desconocidos o eliminados: ${unknown.join(', ')}`);
  }
  if (missing.length > 0) {
    problems.push(`faltan ids: ${missing.join(', ')}`);
  }
  if (problems.length > 0) {
    throw new BadRequestException(
      `ids debe contener exactamente una vez cada elemento no eliminado (${problems.join('; ')})`,
    );
  }
}
