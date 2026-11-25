import { Injectable } from '@nestjs/common';
import type {
  CaseType,
  LeadStatus,
  Locale,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { leadSearchWhere } from '../leads/leads.service.js';

/** Results per group. */
export const SEARCH_GROUP_LIMIT = 5;

export interface SearchResults {
  cases: { id: string; title: string; type: CaseType }[];
  blogPosts: { id: string; title: string }[];
  leads: { id: string; name: string; email: string; status: LeadStatus }[];
  conversations: {
    id: string;
    firstQuestion: string | null;
    lastMessageAt: Date;
  }[];
}

/** The ES title, falling back to EN. */
export function displayTitle(
  translations: { locale: Locale; title: string }[],
): string {
  return (
    translations.find((t) => t.locale === 'ES')?.title ??
    translations.find((t) => t.locale === 'EN')?.title ??
    ''
  );
}

/** Global search of the admin (docs/API.md 11.7). Never returns deleted rows. */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string): Promise<SearchResults> {
    const contains = { contains: q, mode: 'insensitive' as const };
    const take = SEARCH_GROUP_LIMIT;
    const titles = { select: { locale: true, title: true } } as const;

    const [cases, posts, leads, conversations] = await Promise.all([
      this.prisma.case.findMany({
        where: { deletedAt: null, translations: { some: { title: contains } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: { id: true, type: true, translations: titles },
      }),
      this.prisma.blogPost.findMany({
        where: { deletedAt: null, translations: { some: { title: contains } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: { id: true, translations: titles },
      }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, ...leadSearchWhere(q) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: { id: true, name: true, email: true, status: true },
      }),
      this.prisma.conversation.findMany({
        where: { messages: { some: { content: contains } } },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          lastMessageAt: true,
          messages: {
            where: { role: 'USER' },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 1,
            select: { content: true },
          },
        },
      }),
    ]);

    return {
      cases: cases.map((row) => ({
        id: row.id,
        title: displayTitle(row.translations),
        type: row.type,
      })),
      blogPosts: posts.map((row) => ({
        id: row.id,
        title: displayTitle(row.translations),
      })),
      leads,
      conversations: conversations.map((row) => ({
        id: row.id,
        firstQuestion: row.messages[0]?.content.slice(0, 300) ?? null,
        lastMessageAt: row.lastMessageAt,
      })),
    };
  }
}
