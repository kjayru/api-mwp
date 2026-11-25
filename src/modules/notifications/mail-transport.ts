import { createTransport } from 'nodemailer';
import type { Env } from '../../config/env.js';

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

/** Nest token of the MailTransport; `null` when SMTP is not configured. */
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
