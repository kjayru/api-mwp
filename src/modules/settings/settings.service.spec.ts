import { BadRequestException } from '@nestjs/common';
import type { RevalidationService } from '../../common/revalidation/revalidation.service.js';
import { AppValidationPipe } from '../../common/validation/app-validation.pipe.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { UpdateSiteSettingsDto } from './dto/site-settings.dto.js';
import { SettingsService } from './settings.service.js';
import {
  normalizeBusinessHours,
  parseSocialLinks,
  timeRangesError,
} from './site-settings.rules.js';

const pipe = new AppValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validate = (body: unknown) =>
  pipe.transform(body, {
    type: 'body',
    metatype: UpdateSiteSettingsDto,
  }) as Promise<UpdateSiteSettingsDto>;
const errorsOf = async (body: unknown): Promise<string[]> => {
  const error = await validate(body).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  return ((error as BadRequestException).getResponse() as { message: string[] })
    .message;
};

const day = [
  { start: '08:00', end: '13:00' },
  { start: '14:00', end: '19:00' },
];
const valid = {
  contactEmail: ' Hola@MiWebProfesional.com ',
  whatsapp: '+51 987-654-321',
  socialLinks: {
    linkedin: 'https://www.linkedin.com/company/miwebprofesional',
    github: null,
    instagram: null,
  },
  businessHours: {
    mon: day,
    tue: day,
    wed: day,
    thu: day,
    fri: day,
    sat: [],
    sun: [],
  },
  timezone: 'America/Lima',
  meetingDurationMinutes: 45,
};

describe('UpdateSiteSettingsDto (PUT /admin/settings validation)', () => {
  it('accepts a valid body, normalizing the email and the WhatsApp number', async () => {
    const dto = await validate(valid);
    expect(dto.contactEmail).toBe('hola@miwebprofesional.com');
    expect(dto.whatsapp).toBe('51987654321');
  });

  it('accepts whatsapp null (and "" as null)', async () => {
    expect((await validate({ ...valid, whatsapp: null })).whatsapp).toBeNull();
    expect((await validate({ ...valid, whatsapp: '' })).whatsapp).toBeNull();
  });

  it.each([
    [
      'contactEmail',
      { contactEmail: 'nope' },
      'contactEmail debe ser un email válido',
    ],
    [
      'whatsapp too short',
      { whatsapp: '1234567' },
      'whatsapp debe ser null o un número de 8 a 15 dígitos',
    ],
    [
      'whatsapp missing',
      { whatsapp: undefined },
      'whatsapp debe ser null o un número de 8 a 15 dígitos',
    ],
    [
      'timezone',
      { timezone: 'Mars/Olympus' },
      'timezone debe ser una zona horaria IANA válida (p. ej. America/Lima)',
    ],
    [
      'duration step',
      { meetingDurationMinutes: 40 },
      'meetingDurationMinutes debe ser múltiplo de 15',
    ],
  ])('rejects an invalid %s', async (_name, patch, message) => {
    expect(await errorsOf({ ...valid, ...patch })).toContain(message);
  });

  it('rejects durations outside 15-120', async () => {
    expect(
      await errorsOf({ ...valid, meetingDurationMinutes: 10 }),
    ).toHaveLength(2);
    expect(await errorsOf({ ...valid, meetingDurationMinutes: 135 })).toEqual([
      'meetingDurationMinutes must not be greater than 120',
    ]);
  });

  it('social links: exactly the three keys, each null or https', async () => {
    const { instagram: _omit, ...two } = valid.socialLinks;
    expect(await errorsOf({ ...valid, socialLinks: two })).toContain(
      'socialLinks.instagram debe ser null o una URL https',
    );
    expect(
      await errorsOf({
        ...valid,
        socialLinks: { ...valid.socialLinks, tiktok: null },
      }),
    ).toEqual(['socialLinks.property tiktok should not exist']);
    expect(
      await errorsOf({
        ...valid,
        socialLinks: { ...valid.socialLinks, github: 'http://github.com/x' },
      }),
    ).toContain('socialLinks.github debe ser null o una URL https');
    expect(
      await errorsOf({
        ...valid,
        socialLinks: {
          ...valid.socialLinks,
          github: `https://github.com/${'a'.repeat(300)}`,
        },
      }),
    ).toContain('socialLinks.github admite como máximo 300 caracteres');
  });

  it('business hours: seven days, ≤ 3 intervals, HH:mm, sorted without overlaps', async () => {
    const { sun: _sun, ...six } = valid.businessHours;
    expect(await errorsOf({ ...valid, businessHours: six })).toContain(
      'businessHours.sun debe ser una lista',
    );
    const hours = (mon: unknown) => ({
      ...valid,
      businessHours: { ...valid.businessHours, mon },
    });
    expect(
      await errorsOf(
        hours([
          { start: '08:00', end: '09:00' },
          { start: '10:00', end: '11:00' },
          { start: '12:00', end: '13:00' },
          { start: '14:00', end: '15:00' },
        ]),
      ),
    ).toContain('businessHours.mon admite como máximo 3 intervalos');
    expect(await errorsOf(hours([{ start: '24:00', end: '23:00' }]))).toContain(
      'businessHours.mon.0.start debe tener el formato HH:mm (00:00-23:59)',
    );
    expect(await errorsOf(hours([{ start: '10:00', end: '09:00' }]))).toContain(
      'businessHours.mon: el inicio (10:00) debe ser anterior al fin (09:00)',
    );
    expect(
      await errorsOf(
        hours([
          { start: '08:00', end: '12:00' },
          { start: '11:00', end: '13:00' },
        ]),
      ),
    ).toContain(
      'businessHours.mon: los intervalos deben estar ordenados y no superponerse',
    );
  });

  it('reports details.fields as paths of up to two levels', async () => {
    const error = (await validate({
      ...valid,
      contactEmail: 'nope',
      socialLinks: { ...valid.socialLinks, github: 'http://x.com' },
      businessHours: {
        ...valid.businessHours,
        mon: [{ start: '10:00', end: '09:00' }],
        tue: [{ start: '25:00', end: '26:00' }],
      },
    }).catch((e: unknown) => e)) as BadRequestException;
    const body = error.getResponse() as { details: { fields: string[] } };
    expect(body.details.fields.sort()).toEqual([
      'businessHours.mon',
      'businessHours.tue',
      'contactEmail',
      'socialLinks.github',
    ]);
  });

  it('rejects unknown properties such as updatedAt', async () => {
    expect(await errorsOf({ ...valid, updatedAt: '2026-11-25' })).toEqual([
      'property updatedAt should not exist',
    ]);
  });
});

describe('site settings rules', () => {
  it('timeRangesError accepts touching intervals and rejects unsorted ones', () => {
    expect(
      timeRangesError([
        { start: '08:00', end: '12:00' },
        { start: '12:00', end: '13:00' },
      ]),
    ).toBeNull();
    expect(
      timeRangesError([
        { start: '14:00', end: '15:00' },
        { start: '08:00', end: '09:00' },
      ]),
    ).toMatch(/ordenados/);
  });

  it('normalizes stored JSON to three social keys and seven days', () => {
    expect(parseSocialLinks({ linkedin: 'https://x', extra: 'y' })).toEqual({
      linkedin: 'https://x',
      github: null,
      instagram: null,
    });
    expect(Object.keys(normalizeBusinessHours({ mon: [] }))).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ]);
  });
});

describe('SettingsService', () => {
  const prisma = { siteSettings: { findUnique: vi.fn(), upsert: vi.fn() } };
  const revalidation = { revalidate: vi.fn(async () => undefined) };
  const service = new SettingsService(
    prisma as unknown as PrismaService,
    revalidation as unknown as RevalidationService,
  );

  beforeEach(() => vi.clearAllMocks());

  it('update saves the canonical time zone and sends the settings tag', async () => {
    prisma.siteSettings.upsert.mockImplementation(
      async ({ create }: { create: object }) => ({
        ...create,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    const dto = await validate({ ...valid, timezone: 'america/lima' });

    const saved = await service.update(dto);

    expect(saved.timezone).toBe('America/Lima');
    expect(saved.businessHours.sat).toEqual([]);
    expect(revalidation.revalidate).toHaveBeenCalledWith(['settings']);
  });

  it('the public view has contact data, hours and time zone, but not the meeting duration', async () => {
    prisma.siteSettings.findUnique.mockResolvedValue({
      id: 'default',
      contactEmail: 'hola@miwebprofesional.com',
      whatsapp: '51900000000',
      socialLinks: { linkedin: 'https://l' },
      businessHours: { mon: day },
      timezone: 'America/Lima',
      meetingDurationMinutes: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const view = await service.getPublic();

    expect(Object.keys(view).sort()).toEqual([
      'businessHours',
      'contactEmail',
      'socialLinks',
      'timezone',
      'whatsapp',
    ]);
    expect(view.businessHours.mon).toEqual(day);
    expect(view.businessHours.sun).toEqual([]);
  });
});
