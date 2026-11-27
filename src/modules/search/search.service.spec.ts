import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  displayTitle,
  SEARCH_GROUP_LIMIT,
  SearchService,
} from './search.service.js';

describe('displayTitle', () => {
  it('prefers the ES title', () => {
    expect(
      displayTitle([
        { locale: 'EN', title: 'Hello' },
        { locale: 'ES', title: 'Hola' },
      ]),
    ).toBe('Hola');
  });

  it('falls back to EN, then to an empty string', () => {
    expect(displayTitle([{ locale: 'EN', title: 'Hello' }])).toBe('Hello');
    expect(displayTitle([])).toBe('');
  });
});

describe('SearchService', () => {
  const prisma = {
    case: { findMany: vi.fn() },
    blogPost: { findMany: vi.fn() },
    lead: { findMany: vi.fn() },
    conversation: { findMany: vi.fn() },
  };
  let service: SearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.case.findMany.mockResolvedValue([]);
    prisma.blogPost.findMany.mockResolvedValue([]);
    prisma.lead.findMany.mockResolvedValue([]);
    prisma.conversation.findMany.mockResolvedValue([]);
    service = new SearchService(prisma as unknown as PrismaService);
  });

  it('returns four empty groups when nothing matches', async () => {
    expect(await service.search('zzz')).toEqual({
      cases: [],
      blogPosts: [],
      leads: [],
      conversations: [],
    });
  });

  it('searches every group case-insensitively, excluding deleted rows, with a limit', async () => {
    await service.search('react');

    const contains = { contains: 'react', mode: 'insensitive' };
    const caseArgs = prisma.case.findMany.mock.calls[0][0];
    expect(caseArgs.where).toEqual({
      deletedAt: null,
      translations: { some: { title: contains } },
    });
    expect(caseArgs.take).toBe(SEARCH_GROUP_LIMIT);
    expect(prisma.blogPost.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      translations: { some: { title: contains } },
    });
    expect(prisma.lead.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
    expect(prisma.lead.findMany.mock.calls[0][0].take).toBe(SEARCH_GROUP_LIMIT);
    expect(prisma.conversation.findMany.mock.calls[0][0].where).toEqual({
      messages: { some: { content: contains } },
    });
  });

  it('maps rows: display titles, lead fields and the first user question', async () => {
    const lastMessageAt = new Date('2026-11-01T10:00:00Z');
    prisma.case.findMany.mockResolvedValue([
      {
        id: 'c1',
        type: 'SAAS',
        translations: [
          { locale: 'EN', title: 'Case' },
          { locale: 'ES', title: 'Caso' },
        ],
      },
    ]);
    prisma.blogPost.findMany.mockResolvedValue([
      { id: 'b1', translations: [{ locale: 'EN', title: 'Post' }] },
    ]);
    prisma.lead.findMany.mockResolvedValue([
      { id: 'l1', name: 'Ana', email: 'a@x.com', status: 'NEW' },
    ]);
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: 'v1',
        lastMessageAt,
        messages: [{ content: 'x'.repeat(500) }],
      },
      { id: 'v2', lastMessageAt, messages: [] },
    ]);

    const out = await service.search('q');

    expect(out.cases).toEqual([{ id: 'c1', title: 'Caso', type: 'SAAS' }]);
    expect(out.blogPosts).toEqual([{ id: 'b1', title: 'Post' }]);
    expect(out.leads).toEqual([
      { id: 'l1', name: 'Ana', email: 'a@x.com', status: 'NEW' },
    ]);
    expect(out.conversations[0].firstQuestion).toHaveLength(300);
    expect(out.conversations[1].firstQuestion).toBeNull();
    expect(out.conversations[0].lastMessageAt).toBe(lastMessageAt);
  });
});
