import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { toDbLocale } from '../../common/i18n/locale.js';
import type {
  Paginated,
  PaginationMeta,
} from '../../common/pagination/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  LeadSource,
  LeadStatus,
  Locale,
  MeetingStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  type AdminMessage,
  toAdminMessage,
} from '../conversations/conversations.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  type AdminLeadsQueryDto,
  LEAD_STATUSES,
  type UpdateLeadDto,
} from './dto/admin-leads.dto.js';
import { type ContactFormDto, FORM_INTERESTS } from './dto/contact-form.dto.js';
import { RecaptchaService } from './recaptcha.service.js';

export const LEAD_NOT_FOUND = 'Lead no encontrado';

export interface ContactFormResult {
  id: string;
  createdAt: Date;
}

export interface AdminLeadListItem {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  source: LeadSource;
  status: LeadStatus;
  interest: string | null;
  locale: Locale;
  conversationId: string | null;
  /** At least one meeting that is not CANCELLED. */
  hasMeeting: boolean;
  /** Start of the next future BOOKED or REQUESTED meeting. */
  nextMeetingAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminLeadDetail extends AdminLeadListItem {
  message: string | null;
  notes: string | null;
  meetings: {
    id: string;
    status: MeetingStatus;
    start: Date;
    end: Date;
    meetLink: string | null;
    createdAt: Date;
  }[];
  conversation: {
    id: string;
    locale: Locale;
    caseSlug: string | null;
    createdAt: Date;
    messages: AdminMessage[];
  } | null;
}

export type CountsByStatus = Record<LeadStatus, number>;

/** `GET /admin/leads`: the page plus the counts of the status tabs. */
export interface AdminLeadsPage extends Paginated<AdminLeadListItem> {
  meta: PaginationMeta & { countsByStatus: CountsByStatus };
}

const ACTIVE_MEETING: MeetingStatus[] = ['BOOKED', 'REQUESTED'];

/** Lead.message of a form lead: the company first, then what the visitor wrote. */
export function formMessage(message: string, company?: string): string {
  return company ? `Empresa: ${company}\n\n${message}` : message;
}

/** The honeypot counts as filled with any non-blank value. */
export function isHoneypotFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/** cuid-looking id for the fake answer to bots (never stored). */
function fakeId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(24);
  return `c${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

/** Case-insensitive search of 11.4 (also used by the global search). */
export function leadSearchWhere(q: string): Prisma.LeadWhereInput {
  const contains = { contains: q, mode: 'insensitive' as const };
  return {
    OR: [
      { name: contains },
      { email: contains },
      { phone: contains },
      { interest: contains },
      { message: contains },
    ],
  };
}

const listInclude = (now: Date) =>
  ({
    meetings: {
      where: { status: { in: ACTIVE_MEETING }, start: { gt: now } },
      orderBy: [{ start: 'asc' }, { id: 'asc' }],
      take: 1,
      select: { start: true },
    },
    _count: {
      select: { meetings: { where: { status: { not: 'CANCELLED' } } } },
    },
  }) satisfies Prisma.LeadInclude;

type LeadWithMeetings = Prisma.LeadGetPayload<{
  include: ReturnType<typeof listInclude>;
}>;

function toListItem(row: LeadWithMeetings): AdminLeadListItem {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    source: row.source,
    status: row.status,
    interest: row.interest,
    locale: row.locale,
    conversationId: row.conversationId,
    hasMeeting: row._count.meetings > 0,
    nextMeetingAt: row.meetings[0]?.start ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Contact form leads and the admin of every lead (docs/API.md 11.1 and 11.4). */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly recaptcha: RecaptchaService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public contact form
  // ---------------------------------------------------------------------------

  async createFromForm(
    dto: ContactFormDto,
    ip?: string,
  ): Promise<ContactFormResult> {
    if (isHoneypotFilled(dto.website)) {
      // Same answer as a real submission, so bots learn nothing.
      return { id: fakeId(), createdAt: new Date() };
    }
    await this.recaptcha.verify(dto.recaptchaToken, ip);
    const lead = await this.prisma.lead.create({
      data: {
        source: 'FORM',
        status: 'NEW',
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        interest: dto.interest ? FORM_INTERESTS[dto.interest] : null,
        message: formMessage(dto.message, dto.company),
        locale: toDbLocale(dto.locale),
      },
    });
    void this.notifications.notifyNewLead(lead);
    return { id: lead.id, createdAt: lead.createdAt };
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  async list(
    query: AdminLeadsQueryDto,
    now: Date = new Date(),
  ): Promise<AdminLeadsPage> {
    const { page, limit, status, source, q, sort, order } = query;
    const base: Prisma.LeadWhereInput = {
      deletedAt: null,
      ...(source ? { source } : {}),
      ...(q ? leadSearchWhere(q) : {}),
    };
    const where: Prisma.LeadWhereInput = status ? { ...base, status } : base;
    const [rows, total, groups] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: [{ [sort]: order }, { id: order }],
        skip: (page - 1) * limit,
        take: limit,
        include: listInclude(now),
      }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: base,
        _count: { _all: true },
      }),
    ]);
    const countsByStatus = Object.fromEntries(
      LEAD_STATUSES.map((s) => [s, 0]),
    ) as CountsByStatus;
    for (const group of groups) {
      countsByStatus[group.status] = group._count._all;
    }
    return {
      data: rows.map(toListItem),
      meta: { page, limit, total, countsByStatus },
    };
  }

  async detail(id: string, now: Date = new Date()): Promise<AdminLeadDetail> {
    const row = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...listInclude(now),
        conversation: {
          include: {
            messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          },
        },
      },
    });
    if (!row) throw new NotFoundException(LEAD_NOT_FOUND);
    const meetings = await this.prisma.meeting.findMany({
      where: { leadId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const { conversation } = row;
    return {
      ...toListItem(row),
      message: row.message,
      notes: row.notes,
      meetings: meetings.map((m) => ({
        id: m.id,
        status: m.status,
        start: m.start,
        end: m.end,
        meetLink: m.meetLink,
        createdAt: m.createdAt,
      })),
      conversation: conversation
        ? {
            id: conversation.id,
            locale: conversation.locale,
            caseSlug: conversation.caseSlug,
            createdAt: conversation.createdAt,
            messages: conversation.messages.map(toAdminMessage),
          }
        : null,
    };
  }

  async update(id: string, dto: UpdateLeadDto): Promise<AdminLeadDetail> {
    await this.assertExists(id);
    const data: Prisma.LeadUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) {
      data.notes =
        dto.notes === null || dto.notes.trim() === '' ? null : dto.notes;
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.lead.update({ where: { id }, data });
    }
    return this.detail(id);
  }

  /** Soft delete. The conversation loses its "lead" flag when it has no other lead. */
  async remove(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, conversationId: true },
      });
      if (!lead) throw new NotFoundException(LEAD_NOT_FOUND);
      await tx.lead.update({ where: { id }, data: { deletedAt: new Date() } });
      if (lead.conversationId) {
        const others = await tx.lead.count({
          where: { conversationId: lead.conversationId, deletedAt: null },
        });
        if (others === 0) {
          await tx.conversation.update({
            where: { id: lead.conversationId },
            data: { hasLead: false },
          });
        }
      }
    });
  }

  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(LEAD_NOT_FOUND);
  }
}
