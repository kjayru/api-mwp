import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { buildLeadEmail, type LeadEmailData } from './lead-email.js';
import { MAIL_TRANSPORT, type MailTransport } from './mail-transport.js';

export interface NotificationOptions {
  /** MAIL_FROM with Brevo, SMTP_FROM with SMTP. */
  from?: string;
  /** ADMIN_URL, without a trailing slash. */
  adminUrl: string;
  /** Upper bound of one send, on top of the SMTP client timeouts. */
  timeoutMs: number;
}

export const NOTIFICATION_OPTIONS = Symbol('NOTIFICATION_OPTIONS');
export const NOTIFICATION_TIMEOUT_MS = 10_000;

/**
 * Emails the team (SiteSettings.contactEmail) about new leads. Fire-and-forget:
 * the returned promise never rejects and callers do not await it, so SMTP
 * problems never fail or delay the request that created the lead.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    @Inject(NOTIFICATION_OPTIONS) private readonly options: NotificationOptions,
  ) {}

  notifyNewLead(lead: LeadEmailData): Promise<void> {
    return this.send(lead).catch((error: unknown) => {
      this.logger.warn(
        `Lead notification failed for lead ${lead.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  private async send(lead: LeadEmailData): Promise<void> {
    const { transport } = this;
    const { from, adminUrl, timeoutMs } = this.options;
    if (!transport || !from) {
      this.logger.log(
        'Lead notification skipped (no email provider configured)',
      );
      return;
    }
    const settings = await this.prisma.siteSettings.findUnique({
      where: { id: 'default' },
      select: { contactEmail: true },
    });
    if (!settings?.contactEmail) {
      this.logger.warn(
        'Lead notification skipped (SiteSettings.contactEmail is not set)',
      );
      return;
    }

    const email = buildLeadEmail(lead, adminUrl);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
    });
    try {
      await Promise.race([
        transport.sendMail({
          from,
          to: settings.contactEmail,
          replyTo: lead.email,
          ...email,
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
    this.logger.log(`Lead notification sent for lead ${lead.id}`);
  }
}
