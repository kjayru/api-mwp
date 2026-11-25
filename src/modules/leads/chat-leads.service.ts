import { Injectable } from '@nestjs/common';
import type { Lead } from '../../generated/prisma/client.js';
import type { Locale } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface ChatLeadInput {
  name: string;
  email: string;
  phone?: string | null;
  interest?: string | null;
  /** Summary of the conversation written by the assistant (Lead.message). */
  summary?: string | null;
}

export interface UpsertOptions {
  /**
   * Keep the phone, interest and summary already stored and only fill the
   * empty ones (agendar_reunion must not overwrite what crear_lead wrote).
   */
  fillOnly?: boolean;
}

/**
 * Leads that come from the AI chat (source CHAT_IA). One lead per
 * conversation: calling it again updates that lead instead of duplicating it.
 */
@Injectable()
export class ChatLeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    conversationId: string,
    locale: Locale,
    input: ChatLeadInput,
    options: UpsertOptions = {},
  ): Promise<{ lead: Lead; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.lead.findFirst({
        where: { conversationId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      const keep = (stored: string | null | undefined) =>
        Boolean(options.fillOnly && stored);
      // undefined = leave the stored value as it is.
      const data = {
        name: input.name,
        email: input.email.toLowerCase(),
        phone: keep(existing?.phone) ? undefined : input.phone || undefined,
        interest: keep(existing?.interest)
          ? undefined
          : input.interest || undefined,
        message: keep(existing?.message) ? undefined : input.summary || undefined,
      };
      const lead = existing
        ? await tx.lead.update({ where: { id: existing.id }, data })
        : await tx.lead.create({
            data: { ...data, source: 'CHAT_IA', locale, conversationId },
          });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { hasLead: true },
      });
      return { lead, created: !existing };
    });
  }
}
