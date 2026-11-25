import type { Interval } from './business-hours.js';
import {
  type CalendarEvent,
  type CalendarEventInput,
  CalendarError,
  type CalendarProvider,
} from './calendar-provider.js';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
/** The studio account's own calendar (decision 6). */
export const CALENDAR_ID = 'primary';
const TIMEOUT_MS = 15_000;
/** Refresh the access token this long before it expires. */
const EXPIRY_MARGIN_MS = 60_000;

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  /** Offline refresh token of the studio account (scopes calendar.events + calendar.freebusy). */
  refreshToken: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface FreeBusyResponse {
  calendars?: Record<
    string,
    { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }
  >;
}

interface EventResponse {
  id?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
}

/**
 * Google Calendar over its REST API with plain fetch (no googleapis
 * dependency): OAuth 2.0 refresh-token grant, freeBusy and events.insert
 * with conferenceData (Meet) and sendUpdates=all (the visitor gets the
 * invitation email).
 */
export class GoogleCalendarProvider implements CalendarProvider {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly credentials: GoogleCredentials | null,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  get configured(): boolean {
    return this.credentials !== null;
  }

  async busyIntervals(timeMin: Date, timeMax: Date): Promise<Interval[]> {
    const body = (await this.call('POST', `${GOOGLE_CALENDAR_API}/freeBusy`, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: CALENDAR_ID }],
    })) as FreeBusyResponse;
    const calendar = body.calendars?.[CALENDAR_ID];
    if (!calendar || (calendar.errors && calendar.errors.length > 0)) {
      throw new CalendarError(
        `freeBusy failed for the primary calendar: ${calendar?.errors?.map((e) => e.reason).join(', ') ?? 'no data'}`,
      );
    }
    return (calendar.busy ?? []).map((interval) => ({
      start: new Date(interval.start),
      end: new Date(interval.end),
    }));
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    const url = `${GOOGLE_CALENDAR_API}/calendars/${CALENDAR_ID}/events?conferenceDataVersion=1&sendUpdates=all`;
    const body = (await this.call('POST', url, {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
      end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
      attendees: [
        { email: input.attendee.email, displayName: input.attendee.name },
      ],
      conferenceData: {
        createRequest: {
          requestId: input.requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: { useDefault: true },
    })) as EventResponse;
    if (!body.id) throw new CalendarError('events.insert returned no id');
    const video = body.conferenceData?.entryPoints?.find(
      (entry) => entry.entryPointType === 'video',
    );
    return {
      eventId: body.id,
      meetLink: body.hangoutLink ?? video?.uri ?? null,
      htmlLink: body.htmlLink ?? null,
    };
  }

  private async accessToken(): Promise<string> {
    if (!this.credentials) {
      throw new CalendarError('Google Calendar is not configured');
    }
    if (this.token && this.token.expiresAt - EXPIRY_MARGIN_MS > this.now()) {
      return this.token.value;
    }
    const response = await this.fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !body.access_token) {
      // e.g. invalid_grant: the refresh token was revoked; re-authorise the account.
      throw new CalendarError(
        `OAuth token refresh failed (${response.status}): ${body.error ?? 'unknown error'}`,
      );
    }
    this.token = {
      value: body.access_token,
      expiresAt: this.now() + (body.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  private async call(method: string, url: string, payload: unknown): Promise<unknown> {
    const token = await this.accessToken();
    const response = await this.fetchFn(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401) {
      // Revoked or expired early: forget it so the next call refreshes.
      this.token = null;
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new CalendarError(
        `Google Calendar answered ${response.status}: ${detail}`,
      );
    }
    return response.json();
  }
}
