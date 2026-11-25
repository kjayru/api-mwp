import type { PrismaService } from '../../prisma/prisma.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { AnalyticsService, localDay } from './analytics.service.js';
import {
  isBotUserAgent,
  normalizeTrackedPath,
  trackedLocale,
} from './page-views.js';

const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';

describe('page view rules', () => {
  it('normalizes the path: no query or hash, no trailing slash, lowercase', () => {
    expect(normalizeTrackedPath('/es/Casos/CorteMaestro/?utm=x#top')).toBe(
      '/es/casos/cortemaestro',
    );
    expect(normalizeTrackedPath('/es/')).toBe('/es');
    expect(normalizeTrackedPath('/en')).toBe('/en');
    expect(normalizeTrackedPath('/EN?x=1')).toBe('/en');
  });

  it('ignores paths outside /es and /en, /api/ paths, long paths and junk', () => {
    expect(normalizeTrackedPath('/')).toBeNull();
    expect(normalizeTrackedPath('/estudio')).toBeNull();
    expect(normalizeTrackedPath('/fr/cases')).toBeNull();
    expect(normalizeTrackedPath('https://evil.example/es')).toBeNull();
    expect(normalizeTrackedPath('/es/api/revalidate')).toBeNull();
    expect(normalizeTrackedPath(`/es/${'a'.repeat(197)}`)).toBeNull();
    expect(normalizeTrackedPath(`/es/${'a'.repeat(196)}`)).toHaveLength(200);
    expect(normalizeTrackedPath('/es/a b')).toBeNull();
    expect(normalizeTrackedPath(42)).toBeNull();
  });

  it('requires a locale that matches the path', () => {
    expect(trackedLocale('es', '/es/casos')).toBe('ES');
    expect(trackedLocale('en', '/en')).toBe('EN');
    expect(trackedLocale('en', '/es/casos')).toBeNull();
    expect(trackedLocale('ES', '/es')).toBeNull();
  });

  it('filters bots and empty user agents', () => {
    expect(isBotUserAgent(BROWSER)).toBe(false);
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent('  ')).toBe(true);
    for (const ua of [
      'Googlebot/2.1',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'facebookexternalhit/1.1 Preview',
      'Mozilla/5.0 HeadlessChrome/120',
      'Chrome-Lighthouse',
      'curl/8.4.0',
      'python-requests/2.31',
      'axios/1.7.0',
      'node-fetch/3',
      'Go-http-client/1.1',
      'UptimeRobot monitor',
    ]) {
      expect(isBotUserAgent(ua)).toBe(true);
    }
  });

  it('localDay uses the calendar day of the site time zone', () => {
    // 23:30 in Lima is already the next day in UTC.
    expect(localDay(new Date('2026-11-26T04:30:00Z'), 'America/Lima')).toEqual(
      new Date('2026-11-25T00:00:00Z'),
    );
  });
});

describe('AnalyticsService.track', () => {
  const prisma = { pageView: { upsert: vi.fn() } };
  const settings = { timeZone: vi.fn(async () => 'America/Lima') };
  const service = new AnalyticsService(
    prisma as unknown as PrismaService,
    settings as unknown as SettingsService,
  );
  const now = new Date('2026-11-25T15:00:00Z');

  beforeEach(() => vi.clearAllMocks());

  it('upserts +1 on (date, path, locale)', async () => {
    const counted = await service.track(
      { body: { path: '/es/casos/x/', locale: 'es' }, userAgent: BROWSER },
      now,
    );

    expect(counted).toBe(true);
    const key = {
      date: new Date('2026-11-25T00:00:00Z'),
      path: '/es/casos/x',
      locale: 'ES',
    };
    expect(prisma.pageView.upsert).toHaveBeenCalledWith({
      where: { date_path_locale: key },
      create: { ...key, count: 1 },
      update: { count: { increment: 1 } },
    });
  });

  it('ignores bots and invalid bodies without throwing', async () => {
    expect(
      await service.track(
        { body: { path: '/es', locale: 'es' }, userAgent: 'curl/8' },
        now,
      ),
    ).toBe(false);
    expect(await service.track({ body: null, userAgent: BROWSER }, now)).toBe(
      false,
    );
    expect(
      await service.track({ body: { path: '/es' }, userAgent: BROWSER }, now),
    ).toBe(false);
    expect(prisma.pageView.upsert).not.toHaveBeenCalled();
  });

  it('retries once on a unique violation and never throws on database errors', async () => {
    prisma.pageView.upsert
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
      .mockResolvedValueOnce({});
    expect(
      await service.track(
        { body: { path: '/en', locale: 'en' }, userAgent: BROWSER },
        now,
      ),
    ).toBe(true);
    expect(prisma.pageView.upsert).toHaveBeenCalledTimes(2);

    prisma.pageView.upsert.mockRejectedValueOnce(new Error('db down'));
    expect(
      await service.track(
        { body: { path: '/en', locale: 'en' }, userAgent: BROWSER },
        now,
      ),
    ).toBe(false);
  });
});
