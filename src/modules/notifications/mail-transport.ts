import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { type Env, parseMailFrom } from '../../config/env.js';

/** One email, as handed to the transport. */
export interface MailMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

/** The part of a nodemailer transporter the API uses (faked in tests). */
export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

/** Nest token of the MailTransport; `null` when no email provider is configured. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Connection, greeting and socket timeouts of the SMTP client. */
export const SMTP_TIMEOUT_MS = 10_000;

type SmtpEnv = Pick<
  Env,
  'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'SMTP_SECURE'
>;

/** SMTP transport from the SMTP_* variables, or null when they are not set (env.ts validates all-or-none). */
export function createSmtpTransport(env: SmtpEnv): MailTransport | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;
  return createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE ? SMTP_SECURE === 'true' : SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    dnsTimeout: SMTP_TIMEOUT_MS,
  });
}

export const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
export const BREVO_TIMEOUT_MS = 10_000;

interface BrevoResponseBody {
  messageId?: string;
  code?: string;
  message?: string;
}

/** Brevo transactional email over its REST API (no extra dependency). */
export class BrevoTransport implements MailTransport {
  private readonly logger = new Logger(BrevoTransport.name);

  constructor(private readonly apiKey: string) {}

  async sendMail(message: MailMessage): Promise<unknown> {
    const sender = parseMailFrom(message.from);
    if (!sender) throw new Error('Brevo: invalid sender address');
    const replyTo = message.replyTo ? parseMailFrom(message.replyTo) : null;
    const response = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: message.to }],
        ...(replyTo ? { replyTo } : {}),
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        tags: ['lead'],
      }),
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });
    const body = (await response
      .json()
      .catch(() => null)) as BrevoResponseBody | null;
    if (!response.ok) {
      const detail = [body?.code, body?.message].filter(Boolean).join(': ');
      throw new Error(
        `Brevo responded ${response.status}${detail ? ` (${detail})` : ''}`,
      );
    }
    this.logger.log(`Brevo accepted the email (messageId ${body?.messageId})`);
    return body;
  }
}

type MailEnv = SmtpEnv & Pick<Env, 'BREVO_API_KEY'>;

/** Brevo when BREVO_API_KEY is set, else SMTP when configured, else null. */
export function createMailTransport(env: MailEnv): MailTransport | null {
  if (env.BREVO_API_KEY) return new BrevoTransport(env.BREVO_API_KEY);
  return createSmtpTransport(env);
}
