import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AppValidationPipe } from '../../common/validation/app-validation.pipe.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { ContactFormDto } from './dto/contact-form.dto.js';
import {
  formMessage,
  isHoneypotFilled,
  LeadsService,
} from './leads.service.js';

const pipe = new AppValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validate = (body: unknown) =>
  pipe.transform(body, {
    type: 'body',
    metatype: ContactFormDto,
  }) as Promise<ContactFormDto>;

const valid = {
  name: '  Ana Torres ',
  email: ' Ana@Example.COM ',
  phone: '+51 987 654 321',
  company: 'Clínica Sur',
  interest: 'SAAS',
  message: 'Queremos una plataforma de citas para tres sedes.',
  locale: 'es',
  consent: true,
  website: '',
};

describe('ContactFormDto (POST /leads validation)', () => {
  it('trims, lowercases the email and drops blank optional fields', async () => {
    const dto = await validate({ ...valid, company: '   ', phone: '' });
    expect(dto.name).toBe('Ana Torres');
    expect(dto.email).toBe('ana@example.com');
    expect(dto.company).toBeUndefined();
    expect(dto.phone).toBeUndefined();
  });

  it('requires consent: true and reports the failed fields in details.fields', async () => {
    const error = await validate({
      ...valid,
      consent: false,
      email: 'nope',
      phone: 'call me',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as {
      message: string[];
      details: { fields: string[] };
    };
    expect(body.details.fields.sort()).toEqual(['consent', 'email', 'phone']);
    expect(body.message).toEqual(
      expect.arrayContaining([
        'consent debe ser true (aceptación de la política de privacidad)',
        'email debe ser un email válido',
      ]),
    );
  });

  it('rejects unknown interests, short messages and unknown properties', async () => {
    const error = (await validate({
      ...valid,
      interest: 'CRYPTO',
      message: 'corto',
      extra: 1,
    }).catch((e: unknown) => e)) as BadRequestException;
    const body = error.getResponse() as { details: { fields: string[] } };
    expect(body.details.fields.sort()).toEqual([
      'extra',
      'interest',
      'message',
    ]);
  });

  it('accepts any honeypot value (never a 400)', async () => {
    await expect(
      validate({ ...valid, website: { x: 1 } }),
    ).resolves.toBeDefined();
  });
});

describe('LeadsService', () => {
  const prisma = {
    lead: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      update: vi.fn(),
    },
    meeting: { findMany: vi.fn() },
    conversation: { update: vi.fn() },
    $transaction: vi.fn(),
  };
  const notifications = { notifyNewLead: vi.fn(async () => undefined) };
  const service = new LeadsService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    prisma.lead.create.mockImplementation(
      async ({ data }: { data: object }) => ({
        id: 'lead-1',
        createdAt: new Date('2026-11-25T15:00:00Z'),
        ...data,
      }),
    );
  });

  describe('createFromForm', () => {
    it('stores a FORM lead with the interest label and the company in the message, and notifies', async () => {
      const dto = await validate(valid);
      const result = await service.createFromForm(dto);

      expect(result).toEqual({
        id: 'lead-1',
        createdAt: new Date('2026-11-25T15:00:00Z'),
      });
      expect(prisma.lead.create).toHaveBeenCalledWith({
        data: {
          source: 'FORM',
          status: 'NEW',
          name: 'Ana Torres',
          email: 'ana@example.com',
          phone: '+51 987 654 321',
          interest: 'Plataforma SaaS',
          message:
            'Empresa: Clínica Sur\n\nQueremos una plataforma de citas para tres sedes.',
          locale: 'ES',
        },
      });
      expect(notifications.notifyNewLead).toHaveBeenCalledTimes(1);
    });

    it('answers like a real submission but stores and sends nothing when the honeypot is filled', async () => {
      const dto = await validate({ ...valid, website: 'http://spam.example' });
      const result = await service.createFromForm(dto);

      expect(result.id).toMatch(/^c[0-9a-z]{24}$/);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(prisma.lead.create).not.toHaveBeenCalled();
      expect(notifications.notifyNewLead).not.toHaveBeenCalled();
    });

    it('helpers: formMessage and isHoneypotFilled', () => {
      expect(formMessage('Hola equipo')).toBe('Hola equipo');
      expect(formMessage('Hola equipo', 'ACME')).toBe(
        'Empresa: ACME\n\nHola equipo',
      );
      expect(isHoneypotFilled('')).toBe(false);
      expect(isHoneypotFilled('  ')).toBe(false);
      expect(isHoneypotFilled(undefined)).toBe(false);
      expect(isHoneypotFilled('x')).toBe(true);
      expect(isHoneypotFilled(0)).toBe(true);
    });
  });

  describe('admin', () => {
    it('list counts every status for the same source and q, ignoring status', async () => {
      prisma.lead.findMany.mockResolvedValue([]);
      prisma.lead.count.mockResolvedValue(0);
      prisma.lead.groupBy.mockResolvedValue([
        { status: 'NEW', _count: { _all: 3 } },
        { status: 'WON', _count: { _all: 1 } },
      ]);

      const page = await service.list({
        page: 1,
        limit: 20,
        status: 'CONTACTED',
        source: 'FORM',
        q: 'ana',
        sort: 'name',
        order: 'asc',
      });

      expect(page.meta.countsByStatus).toEqual({
        NEW: 3,
        CONTACTED: 0,
        PROPOSAL: 0,
        WON: 1,
        LOST: 0,
      });
      const groupWhere = prisma.lead.groupBy.mock.calls[0][0].where;
      expect(groupWhere).toMatchObject({ deletedAt: null, source: 'FORM' });
      expect(groupWhere).not.toHaveProperty('status');
      const listArgs = prisma.lead.findMany.mock.calls[0][0];
      expect(listArgs.where).toMatchObject({
        status: 'CONTACTED',
        source: 'FORM',
      });
      expect(listArgs.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    });

    it('update clears the notes with "" and 404s for deleted leads', async () => {
      prisma.lead.findFirst
        .mockResolvedValueOnce({ id: 'lead-1' })
        .mockResolvedValueOnce(null);
      await expect(
        service.update('lead-1', { notes: '' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { notes: null },
      });
    });

    it('remove soft-deletes and clears hasLead when the conversation has no other lead', async () => {
      prisma.lead.findFirst.mockResolvedValue({
        id: 'lead-1',
        conversationId: 'conv-1',
      });
      prisma.lead.count.mockResolvedValue(0);

      await service.remove('lead-1');

      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { hasLead: false },
      });
    });

    it('remove answers 404 for an unknown or deleted lead', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);
      await expect(service.remove('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
