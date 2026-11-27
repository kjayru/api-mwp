import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  PaginationQueryDto,
} from './pagination.js';

const check = async (query: object) => {
  const dto = plainToInstance(PaginationQueryDto, query);
  return { dto, errors: await validate(dto) };
};

describe('PaginationQueryDto', () => {
  it('defaults to page 1 and the default limit', async () => {
    const { dto, errors } = await check({});
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('converts query strings to numbers', async () => {
    const { dto, errors } = await check({ page: '3', limit: '50' });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 3, limit: 50 });
  });

  it('accepts the maximum limit and rejects one above it', async () => {
    expect((await check({ limit: String(MAX_PAGE_LIMIT) })).errors).toHaveLength(0);
    const { errors } = await check({ limit: String(MAX_PAGE_LIMIT + 1) });
    expect(errors.map((e) => e.property)).toEqual(['limit']);
  });

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: 'abc' },
    { limit: '0' },
  ])('rejects %j', async (q) => {
    const { errors } = await check(q);
    expect(errors).toHaveLength(1);
  });
});
