import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CalendarProvider } from './calendar-provider.js';
import { MeetingsService } from './meetings.service.js';
import { formatLocalDateTime, parseLocalDateTime, zonedTimeToUtc } from './time-zones.js';

const LIMA = 'America/Lima';
const lima = (local: string) => zonedTimeToUtc(parseLocalDateTime(local)!, LIMA)!;
const NOW = lima('2026-11-24T21:00'); // Tuesday night

describe('MeetingsService.schedule', () => {
  const prisma = {
    siteSettings: { findUnique: vi.fn() },
    meeting: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const calendar = {
    configured: true,
    busyIntervals: vi.fn(),
    createEvent: vi.fn(),
  };
  const request = (start: Date) => ({
    conversationId: 'conv-1',
    leadId: 'lead-1',
    name: 'Ana',
    email: 'ana@example.com',
    start,
    visitorTimeZone: 'America/Bogota',
    reason: 'Plataforma SaaS',
  });
  let service: MeetingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    calendar.configured = true;
    prisma.siteSettings.findUnique.mockResolvedValue({
      businessHours: {
        mon: [{ start: '08:00', end: '19:00' }],
        tue: [{ start: '08:00', end: '19:00' }],
        wed: [{ start: '08:00', end: '19:00' }],
        thu: [{ start: '08:00', end: '19:00' }],
        fri: [{ start: '08:00', end: '19:00' }],
        sat: [{ start: '08:00', end: '19:00' }],
        sun: [],
      },
      timezone: LIMA,
      meetingDurationMinutes: 30,
    });
    prisma.meeting.findFirst.mockResolvedValue(null);
    prisma.meeting.create.mockImplementation(async ({ data }: { data: object }) => ({
      id: 'meeting-1',
      ...data,
    }));
    calendar.busyIntervals.mockResolvedValue([]);
    calendar.createEvent.mockResolvedValue({
      eventId: 'evt-1',
      meetLink: 'https://meet.google.com/x',
      htmlLink: null,
    });
    service = new MeetingsService(
      prisma as unknown as PrismaService,
      calendar as unknown as CalendarProvider,
    );
  });

  it('books a free slot: event with Meet link, Meeting BOOKED with the eventId', async () => {
    const start = lima('2026-11-25T10:00');

    const outcome = await service.schedule(request(start), NOW);

    expect(outcome).toMatchObject({ status: 'BOOKED', meetLink: 'https://meet.google.com/x' });
    expect(calendar.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        start,
        end: lima('2026-11-25T10:30'),
        timeZone: LIMA,
        attendee: { email: 'ana@example.com', name: 'Ana' },
      }),
    );
    expect(prisma.meeting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        googleEventId: 'evt-1',
        status: 'BOOKED',
        timezone: 'America/Bogota',
        leadId: 'lead-1',
      }),
    });
  });

  it('proposes up to 3 free alternatives inside business hours when the slot is busy', async () => {
    calendar.busyIntervals.mockResolvedValue([
      { start: lima('2026-11-25T10:00'), end: lima('2026-11-25T11:00') },
    ]);

    const outcome = await service.schedule(request(lima('2026-11-25T10:00')), NOW);

    expect(outcome.status).toBe('UNAVAILABLE');
    if (outcome.status !== 'UNAVAILABLE') return;
    expect(outcome.reason).toBe('busy');
    expect(outcome.alternatives.map((d) => formatLocalDateTime(d, LIMA))).toEqual([
      '2026-11-25T11:00',
      '2026-11-25T11:30',
      '2026-11-25T12:00',
    ]);
    expect(calendar.createEvent).not.toHaveBeenCalled();
  });

  it('never books on Sunday or past 19:00; alternatives start on the next working day', async () => {
    const sunday = await service.schedule(request(lima('2026-11-29T10:00')), NOW);
    expect(sunday).toMatchObject({ status: 'UNAVAILABLE', reason: 'outside_hours' });
    if (sunday.status !== 'UNAVAILABLE') return;
    expect(formatLocalDateTime(sunday.alternatives[0], LIMA)).toBe('2026-11-30T08:00');

    const late = await service.schedule(request(lima('2026-11-25T18:45')), NOW);
    expect(late).toMatchObject({ status: 'UNAVAILABLE', reason: 'outside_hours' });
    expect(calendar.createEvent).not.toHaveBeenCalled();
  });

  it('rejects slots with less than 2 hours of notice', async () => {
    const outcome = await service.schedule(request(lima('2026-11-24T22:00')), NOW);
    expect(outcome).toMatchObject({ status: 'UNAVAILABLE', reason: 'too_soon' });
  });

  it('without Google Calendar, stores a REQUESTED meeting (one per conversation)', async () => {
    calendar.configured = false;
    const start = lima('2026-11-25T10:00');

    const first = await service.schedule(request(start), NOW);
    expect(first).toMatchObject({ status: 'REQUESTED', calendarFailed: false });
    expect(prisma.meeting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'REQUESTED', conversationId: 'conv-1' }),
    });
    expect(calendar.busyIntervals).not.toHaveBeenCalled();

    prisma.meeting.findFirst
      .mockResolvedValueOnce(null) // no BOOKED meeting
      .mockResolvedValueOnce({ id: 'meeting-1' }); // existing REQUESTED
    prisma.meeting.update.mockResolvedValue({ id: 'meeting-1' });
    await service.schedule(request(lima('2026-11-26T11:00')), NOW);
    expect(prisma.meeting.update).toHaveBeenCalledWith({
      where: { id: 'meeting-1' },
      data: expect.objectContaining({ start: lima('2026-11-26T11:00') }),
    });
  });

  it('falls back to REQUESTED when Google Calendar fails', async () => {
    calendar.busyIntervals.mockRejectedValue(new Error('invalid_grant'));
    const outcome = await service.schedule(request(lima('2026-11-25T10:00')), NOW);
    expect(outcome).toMatchObject({ status: 'REQUESTED', calendarFailed: true });
  });

  it('does not book twice in the same conversation', async () => {
    prisma.meeting.findFirst.mockResolvedValueOnce({
      id: 'meeting-9',
      start: lima('2026-11-26T09:00'),
      end: lima('2026-11-26T09:30'),
      meetLink: 'https://meet.google.com/y',
    });
    const outcome = await service.schedule(request(lima('2026-11-25T10:00')), NOW);
    expect(outcome).toMatchObject({ status: 'ALREADY_BOOKED', meetingId: 'meeting-9' });
  });
});
