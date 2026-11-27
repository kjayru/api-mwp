import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { createMailTransport, MAIL_TRANSPORT } from './mail-transport.js';
import {
  NOTIFICATION_OPTIONS,
  NOTIFICATION_TIMEOUT_MS,
  type NotificationOptions,
  NotificationsService,
} from './notifications.service.js';

/** Email notifications to the team (new leads, docs/API.md 11.2). */
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createMailTransport({
          BREVO_API_KEY: config.get('BREVO_API_KEY', { infer: true }),
          SMTP_HOST: config.get('SMTP_HOST', { infer: true }),
          SMTP_PORT: config.get('SMTP_PORT', { infer: true }),
          SMTP_USER: config.get('SMTP_USER', { infer: true }),
          SMTP_PASS: config.get('SMTP_PASS', { infer: true }),
          SMTP_SECURE: config.get('SMTP_SECURE', { infer: true }),
        }),
    },
    {
      provide: NOTIFICATION_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): NotificationOptions => ({
        from: config.get('BREVO_API_KEY', { infer: true })
          ? config.get('MAIL_FROM', { infer: true })
          : config.get('SMTP_FROM', { infer: true }),
        adminUrl: config.get('ADMIN_URL', { infer: true }),
        timeoutMs: NOTIFICATION_TIMEOUT_MS,
      }),
    },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
