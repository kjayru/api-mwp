import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { CALENDAR_PROVIDER } from './calendar-provider.js';
import { GoogleCalendarProvider } from './google-calendar.provider.js';
import { MeetingsService } from './meetings.service.js';

/** Google Calendar (availability and events) and the Meeting entity. */
@Module({
  providers: [
    {
      provide: CALENDAR_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const clientId = config.get('GOOGLE_CLIENT_ID', { infer: true });
        const clientSecret = config.get('GOOGLE_CLIENT_SECRET', { infer: true });
        const refreshToken = config.get('GOOGLE_REFRESH_TOKEN', { infer: true });
        return new GoogleCalendarProvider(
          clientId && clientSecret && refreshToken
            ? { clientId, clientSecret, refreshToken }
            : null,
        );
      },
    },
    MeetingsService,
  ],
  exports: [MeetingsService],
})
export class CalendarModule {}
