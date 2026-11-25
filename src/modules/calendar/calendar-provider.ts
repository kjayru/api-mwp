import type { Interval } from './business-hours.js';

/**
 * The studio's calendar. Implemented with Google Calendar
 * (google-calendar.provider.ts); tests inject a fake through Nest DI.
 */
export const CALENDAR_PROVIDER = Symbol('CALENDAR_PROVIDER');

export interface CalendarEventInput {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  /** Zone the event is displayed in (the studio's, e.g. America/Lima). */
  timeZone: string;
  attendee: { email: string; name: string };
  /** Idempotency key of the Meet link request. */
  requestId: string;
}

export interface CalendarEvent {
  eventId: string;
  meetLink: string | null;
  htmlLink: string | null;
}

export interface CalendarProvider {
  /** False when the GOOGLE_* variables are not set. */
  readonly configured: boolean;
  /** Busy intervals of the primary calendar between the two instants. */
  busyIntervals(timeMin: Date, timeMax: Date): Promise<Interval[]>;
  /** Creates the event with a Google Meet link and invites the attendee. */
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
}

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarError';
  }
}
