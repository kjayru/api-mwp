import {
  candidateStarts,
  DEFAULT_BUSINESS_HOURS,
  firstFreeSlots,
  fitsBusinessHours,
  parseBusinessHours,
} from './business-hours.js';
import {
  formatLocalDateTime,
  isValidTimeZone,
  offsetMinutes,
  parseLocalDateTime,
  zonedParts,
  zonedTimeToUtc,
} from './time-zones.js';

const LIMA = 'America/Lima';
const lima = (local: string) =>
  zonedTimeToUtc(parseLocalDateTime(local)!, LIMA)!;

describe('time zones', () => {
  it('converts Lima wall-clock time to UTC (UTC-5, no DST)', () => {
    expect(lima('2026-11-25T10:00').toISOString()).toBe('2026-11-25T15:00:00.000Z');
    expect(offsetMinutes(new Date('2026-07-01T12:00:00Z'), LIMA)).toBe(-300);
  });

  it('converts other zones, including DST, and rejects skipped times', () => {
    const madrid = zonedTimeToUtc(parseLocalDateTime('2026-07-01T17:00')!, 'Europe/Madrid');
    expect(madrid?.toISOString()).toBe('2026-07-01T15:00:00.000Z');
    // 2026-03-08 02:30 does not exist in New York (clocks jump to 03:00).
    expect(
      zonedTimeToUtc(parseLocalDateTime('2026-03-08T02:30')!, 'America/New_York'),
    ).toBeNull();
  });

  it('parses only well-formed, real local date-times', () => {
    expect(parseLocalDateTime('2026-11-25T09:30')).toEqual({
      year: 2026, month: 11, day: 25, hour: 9, minute: 30,
    });
    expect(parseLocalDateTime('2026-02-30T10:00')).toBeNull();
    expect(parseLocalDateTime('25/11/2026 10:00')).toBeNull();
    expect(parseLocalDateTime('2026-11-25T24:00')).toBeNull();
  });

  it('validates IANA zones and formats local times', () => {
    expect(isValidTimeZone('America/Bogota')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(formatLocalDateTime(new Date('2026-11-25T15:00:00Z'), LIMA)).toBe('2026-11-25T10:00');
    expect(zonedParts(new Date('2026-11-29T15:00:00Z'), LIMA).weekday).toBe(0); // Sunday
  });
});

describe('business hours', () => {
  const hours = DEFAULT_BUSINESS_HOURS;

  it('accepts meetings Monday to Saturday that end by 19:00 (Lima)', () => {
    expect(fitsBusinessHours(lima('2026-11-25T08:00'), 30, hours, LIMA)).toBe(true); // Wed
    expect(fitsBusinessHours(lima('2026-11-28T18:30'), 30, hours, LIMA)).toBe(true); // Sat
    expect(fitsBusinessHours(lima('2026-11-25T18:45'), 30, hours, LIMA)).toBe(false); // ends 19:15
    expect(fitsBusinessHours(lima('2026-11-25T07:59'), 30, hours, LIMA)).toBe(false);
    expect(fitsBusinessHours(lima('2026-11-29T10:00'), 30, hours, LIMA)).toBe(false); // Sunday
  });

  it('judges the slot in the studio zone, whatever the visitor zone', () => {
    // 20:00 in Madrid (winter) = 14:00 in Lima: inside business hours.
    const madrid = zonedTimeToUtc(parseLocalDateTime('2026-11-25T20:00')!, 'Europe/Madrid')!;
    expect(fitsBusinessHours(madrid, 30, hours, LIMA)).toBe(true);
  });

  it('candidate starts skip Sundays and stay inside 08:00-19:00', () => {
    const from = lima('2026-11-28T18:00'); // Saturday 18:00
    const starts = candidateStarts(from, 3, 30, hours, LIMA);
    const locals = starts.slice(0, 4).map((d) => formatLocalDateTime(d, LIMA));
    expect(locals).toEqual([
      '2026-11-28T18:00',
      '2026-11-28T18:30',
      '2026-11-30T08:00', // Monday (Sunday skipped)
      '2026-11-30T08:30',
    ]);
    for (const start of starts) {
      expect(zonedParts(start, LIMA).weekday).not.toBe(0);
      expect(fitsBusinessHours(start, 30, hours, LIMA)).toBe(true);
    }
  });

  it('firstFreeSlots skips busy intervals', () => {
    const candidates = candidateStarts(lima('2026-11-25T10:00'), 0, 30, hours, LIMA);
    const busy = [{ start: lima('2026-11-25T10:00'), end: lima('2026-11-25T11:15') }];
    expect(
      firstFreeSlots(candidates, 30, busy, 3).map((d) => formatLocalDateTime(d, LIMA)),
    ).toEqual(['2026-11-25T11:30', '2026-11-25T12:00', '2026-11-25T12:30']);
  });

  it('parseBusinessHours drops invalid ranges and falls back on garbage', () => {
    expect(parseBusinessHours('nope')).toBe(DEFAULT_BUSINESS_HOURS);
    const parsed = parseBusinessHours({
      mon: [{ start: '09:00', end: '13:00' }, { start: '15:00', end: '14:00' }, 'x'],
      tue: 'bad',
    });
    expect(parsed.mon).toEqual([{ start: '09:00', end: '13:00' }]);
    expect(parsed.tue).toEqual([]);
    expect(parsed.sun).toEqual([]);
  });
});
