import { CalendarError } from './calendar-provider.js';
import {
  GOOGLE_CALENDAR_API,
  GOOGLE_TOKEN_URL,
  GoogleCalendarProvider,
} from './google-calendar.provider.js';

const credentials = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GoogleCalendarProvider', () => {
  let now = 1_000_000;
  const clock = () => now;

  it('is not configured without credentials', async () => {
    const provider = new GoogleCalendarProvider(null, vi.fn());
    expect(provider.configured).toBe(false);
    await expect(provider.busyIntervals(new Date(), new Date())).rejects.toBeInstanceOf(
      CalendarError,
    );
  });

  it('refreshes the access token once and reuses it until it is about to expire', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(json({ calendars: { primary: { busy: [] } } }))
      .mockResolvedValueOnce(json({ calendars: { primary: { busy: [] } } }))
      .mockResolvedValueOnce(json({ access_token: 'token-2', expires_in: 3600 }))
      .mockResolvedValueOnce(json({ calendars: { primary: { busy: [] } } }));
    const provider = new GoogleCalendarProvider(credentials, fetchFn, clock);

    await provider.busyIntervals(new Date(0), new Date(1));
    await provider.busyIntervals(new Date(0), new Date(1));
    now += 3600_000; // expired
    await provider.busyIntervals(new Date(0), new Date(1));

    const [tokenUrl, tokenInit] = fetchFn.mock.calls[0];
    expect(tokenUrl).toBe(GOOGLE_TOKEN_URL);
    expect(Object.fromEntries(new URLSearchParams(tokenInit.body))).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      refresh_token: 'refresh-token',
      grant_type: 'refresh_token',
    });
    expect(fetchFn.mock.calls.filter(([url]) => url === GOOGLE_TOKEN_URL)).toHaveLength(2);
    expect(fetchFn.mock.calls[4][1].headers.authorization).toBe('Bearer token-2');
  });

  it('queries freeBusy on the primary calendar and returns the busy intervals', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: 't', expires_in: 3600 }))
      .mockResolvedValueOnce(
        json({
          calendars: {
            primary: {
              busy: [{ start: '2026-11-25T15:00:00Z', end: '2026-11-25T16:00:00Z' }],
            },
          },
        }),
      );
    const provider = new GoogleCalendarProvider(credentials, fetchFn, clock);

    const busy = await provider.busyIntervals(
      new Date('2026-11-25T13:00:00Z'),
      new Date('2026-11-26T00:00:00Z'),
    );

    const [url, init] = fetchFn.mock.calls[1];
    expect(url).toBe(`${GOOGLE_CALENDAR_API}/freeBusy`);
    expect(JSON.parse(init.body)).toEqual({
      timeMin: '2026-11-25T13:00:00.000Z',
      timeMax: '2026-11-26T00:00:00.000Z',
      items: [{ id: 'primary' }],
    });
    expect(busy).toEqual([
      { start: new Date('2026-11-25T15:00:00Z'), end: new Date('2026-11-25T16:00:00Z') },
    ]);
  });

  it('a free calendar returns no busy intervals; calendar errors throw', async () => {
    const free = new GoogleCalendarProvider(
      credentials,
      vi
        .fn()
        .mockResolvedValueOnce(json({ access_token: 't', expires_in: 3600 }))
        .mockResolvedValueOnce(json({ calendars: { primary: { busy: [] } } })),
      clock,
    );
    await expect(free.busyIntervals(new Date(0), new Date(1))).resolves.toEqual([]);

    const broken = new GoogleCalendarProvider(
      credentials,
      vi
        .fn()
        .mockResolvedValueOnce(json({ access_token: 't', expires_in: 3600 }))
        .mockResolvedValueOnce(
          json({ calendars: { primary: { errors: [{ reason: 'notFound' }] } } }),
        ),
      clock,
    );
    await expect(broken.busyIntervals(new Date(0), new Date(1))).rejects.toThrow(/notFound/);
  });

  it('reports a revoked refresh token', async () => {
    const provider = new GoogleCalendarProvider(
      credentials,
      vi.fn().mockResolvedValue(json({ error: 'invalid_grant' }, 400)),
      clock,
    );
    await expect(provider.busyIntervals(new Date(0), new Date(1))).rejects.toThrow(
      /invalid_grant/,
    );
  });

  it('creates the event with a Meet link and invites the visitor', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: 't', expires_in: 3600 }))
      .mockResolvedValueOnce(
        json({
          id: 'evt-1',
          htmlLink: 'https://calendar.google.com/event?eid=1',
          conferenceData: {
            entryPoints: [
              { entryPointType: 'phone', uri: 'tel:+1' },
              { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' },
            ],
          },
        }),
      );
    const provider = new GoogleCalendarProvider(credentials, fetchFn, clock);

    const event = await provider.createEvent({
      summary: 'Llamada',
      description: 'Motivo',
      start: new Date('2026-11-25T15:00:00Z'),
      end: new Date('2026-11-25T15:30:00Z'),
      timeZone: 'America/Lima',
      attendee: { email: 'ana@example.com', name: 'Ana' },
      requestId: 'req-1',
    });

    const [url, init] = fetchFn.mock.calls[1];
    expect(url).toBe(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`,
    );
    const body = JSON.parse(init.body);
    expect(body.attendees).toEqual([{ email: 'ana@example.com', displayName: 'Ana' }]);
    expect(body.start).toEqual({ dateTime: '2026-11-25T15:00:00.000Z', timeZone: 'America/Lima' });
    expect(body.conferenceData.createRequest).toEqual({
      requestId: 'req-1',
      conferenceSolutionKey: { type: 'hangoutsMeet' },
    });
    expect(event).toEqual({
      eventId: 'evt-1',
      meetLink: 'https://meet.google.com/abc-defg-hij',
      htmlLink: 'https://calendar.google.com/event?eid=1',
    });
  });
});
