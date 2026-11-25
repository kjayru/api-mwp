import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { UserRole } from '../src/generated/prisma/enums.js';
import type { AccessTokenPayload } from '../src/modules/auth/entities/auth-response.entity.js';
import { hashPassword } from '../src/modules/auth/scrypt.js';
import {
  MAIL_TRANSPORT,
  type MailMessage,
  type MailTransport,
} from '../src/modules/notifications/mail-transport.js';
import {
  NOTIFICATION_OPTIONS,
  type NotificationOptions,
} from '../src/modules/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { accessToken, bearer } from './utils/auth.js';
import { createBlogPost, createCase } from './utils/content.js';
import {
  createTestApp,
  resetThrottler,
  truncateAll,
} from './utils/test-app.js';

const BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';

const week = [{ start: '08:00', end: '19:00' }];
const SETTINGS = {
  contactEmail: 'hola@miwebprofesional.com',
  whatsapp: '51900000000',
  socialLinks: {
    linkedin: 'https://www.linkedin.com/company/miwebprofesional',
    github: null,
    instagram: null,
  },
  businessHours: {
    mon: week,
    tue: week,
    wed: week,
    thu: week,
    fri: week,
    sat: week,
    sun: [],
  },
  timezone: 'America/Lima',
  meetingDurationMinutes: 30,
};

const FORM = {
  name: 'Ana Torres',
  email: 'Ana@Example.com',
  phone: '+51 987 654 321',
  company: 'Clínica Sur',
  interest: 'SAAS',
  message: 'Queremos una plataforma de citas para tres sedes.',
  locale: 'es',
  consent: true,
  website: '',
};

class FakeTransport implements MailTransport {
  sent: MailMessage[] = [];
  async sendMail(message: MailMessage): Promise<unknown> {
    this.sent.push(message);
    return {};
  }
}

/** Waits until `check` passes (fire-and-forget work such as the email). */
async function eventually(check: () => void, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

describe('Phase 5 (e2e): leads, visits, settings, users and search', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let editor: { Authorization: string };
  let admin: { Authorization: string };
  const mail = new FakeTransport();
  const notificationOptions: NotificationOptions = {
    from: 'miwebprofesional <no-reply@miwebprofesional.com>',
    adminUrl: 'https://admin.example.com',
    timeoutMs: 2000,
  };
  const http = () => request(app.getHttpServer());
  let ipCounter = 0;
  /** A fresh client IP (X-Forwarded-For is trusted from loopback). */
  const nextIp = () => `203.0.113.${++ipCounter}`;

  const sign = (id: string, role: UserRole, sid?: string) => {
    const payload: AccessTokenPayload = {
      sub: id,
      email: `${id}@x.com`,
      role,
      ...(sid ? { sid } : {}),
    };
    return bearer(app.get(JwtService).sign(payload));
  };

  beforeAll(async () => {
    app = await createTestApp([], (builder) =>
      builder
        .overrideProvider(MAIL_TRANSPORT)
        .useValue(mail)
        .overrideProvider(NOTIFICATION_OPTIONS)
        .useValue(notificationOptions),
    );
    prisma = app.get(PrismaService);
    editor = bearer(accessToken(app, 'EDITOR'));
    admin = bearer(accessToken(app, 'ADMIN'));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    resetThrottler(app);
    mail.sent = [];
    await prisma.siteSettings.create({ data: { id: 'default', ...SETTINGS } });
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 11.0 trust proxy
  // ---------------------------------------------------------------------------

  it('trusts X-Forwarded-For from loopback, so each visitor IP has its own limit', async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      await http()
        .post('/api/v1/leads')
        .set('X-Forwarded-For', ip)
        .send(FORM)
        .expect(201);
    }
    await http()
      .post('/api/v1/leads')
      .set('X-Forwarded-For', ip)
      .send(FORM)
      .expect(429);
    // Another visitor behind the same proxy is not affected.
    await http()
      .post('/api/v1/leads')
      .set('X-Forwarded-For', nextIp())
      .send(FORM)
      .expect(201);
  });

  // ---------------------------------------------------------------------------
  // 11.1 / 11.2 contact form and notification
  // ---------------------------------------------------------------------------

  describe('POST /leads', () => {
    it('stores a FORM lead and emails the team', async () => {
      const res = await http()
        .post('/api/v1/leads')
        .set('X-Forwarded-For', nextIp())
        .send(FORM)
        .expect(201);

      expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'id']);
      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(lead).toMatchObject({
        source: 'FORM',
        status: 'NEW',
        email: 'ana@example.com',
        interest: 'Plataforma SaaS',
        message:
          'Empresa: Clínica Sur\n\nQueremos una plataforma de citas para tres sedes.',
        locale: 'ES',
        conversationId: null,
      });
      await eventually(() => expect(mail.sent).toHaveLength(1));
      expect(mail.sent[0]).toMatchObject({
        to: 'hola@miwebprofesional.com',
        replyTo: 'ana@example.com',
      });
      expect(mail.sent[0].text).toContain(
        `https://admin.example.com/leads/${lead.id}`,
      );
    });

    it('answers 201 to the honeypot but stores and sends nothing', async () => {
      const res = await http()
        .post('/api/v1/leads')
        .set('X-Forwarded-For', nextIp())
        .send({ ...FORM, website: 'https://spam.example' })
        .expect(201);

      expect(res.body.id).toEqual(expect.any(String));
      expect(await prisma.lead.count()).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mail.sent).toHaveLength(0);
    });

    it('400 lists the invalid fields in details.fields', async () => {
      const res = await http()
        .post('/api/v1/leads')
        .set('X-Forwarded-For', nextIp())
        .send({ ...FORM, email: 'nope', phone: 'abc', consent: false })
        .expect(400);

      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        path: '/api/v1/leads',
      });
      expect(res.body.message).toEqual(
        expect.arrayContaining(['email debe ser un email válido']),
      );
      expect(res.body.details.fields.sort()).toEqual([
        'consent',
        'email',
        'phone',
      ]);
    });

    it('429 rate_limit in the visitor language after 5 per hour', async () => {
      const ip = nextIp();
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/api/v1/leads')
          .set('X-Forwarded-For', ip)
          .send(FORM)
          .expect(201);
      }
      const res = await http()
        .post('/api/v1/leads')
        .set('X-Forwarded-For', ip)
        .send({ ...FORM, locale: 'en' })
        .expect(429);
      expect(res.body).toMatchObject({
        statusCode: 429,
        error: 'Too Many Requests',
        details: { reason: 'rate_limit' },
      });
      expect(res.body.message).toMatch(/too many/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 11.3 page views and 11.8 dashboard
  // ---------------------------------------------------------------------------

  describe('POST /track', () => {
    const track = (body: unknown, ip = '198.51.100.1', ua = BROWSER) =>
      http()
        .post('/api/v1/track')
        .set('X-Forwarded-For', ip)
        .set('User-Agent', ua)
        .send(body as object);

    it('counts normalized views per day, path and locale, and ignores the rest (always 204)', async () => {
      await track({
        path: '/es/Casos/CorteMaestro/?utm=1',
        locale: 'es',
      }).expect(204);
      await track({ path: '/es/casos/cortemaestro#x', locale: 'es' }).expect(
        204,
      );
      await track({ path: '/en', locale: 'en' }).expect(204);
      // Ignored: bot, other prefix, /api/, mismatched locale, junk bodies.
      await track(
        { path: '/es', locale: 'es' },
        undefined,
        'Googlebot/2.1',
      ).expect(204);
      await track({ path: '/admin', locale: 'es' }).expect(204);
      await track({ path: '/es/api/x', locale: 'es' }).expect(204);
      await track({ path: '/en/cases', locale: 'es' }).expect(204);
      await track({ nope: true }).expect(204);
      await track([1, 2]).expect(204);

      const rows = await prisma.pageView.findMany({ orderBy: { path: 'asc' } });
      expect(rows.map((r) => [r.path, r.locale, r.count])).toEqual([
        ['/en', 'EN', 1],
        ['/es/casos/cortemaestro', 'ES', 2],
      ]);
    });

    it('stops counting after 60 per minute per IP, still answering 204', async () => {
      for (let i = 0; i < 61; i++) {
        await track({ path: '/es', locale: 'es' }, '198.51.100.7').expect(204);
      }
      const row = await prisma.pageView.findFirstOrThrow({
        where: { path: '/es' },
      });
      expect(row.count).toBe(60);
    });

    it('feeds the dashboard: visits per day, totals and topPages', async () => {
      await track({ path: '/es', locale: 'es' }).expect(204);
      await track({ path: '/es', locale: 'es' }).expect(204);
      await track({ path: '/en/cases', locale: 'en' }).expect(204);

      const res = await http()
        .get('/api/v1/admin/stats/overview?days=7')
        .set(editor)
        .expect(200);
      expect(res.body.totals.visits).toBe(3);
      expect(res.body.series.at(-1)).toMatchObject({ visits: 3 });
      expect(res.body.series[0]).toEqual(
        expect.objectContaining({ visits: 0, conversations: 0, leads: 0 }),
      );
      expect(res.body.topPages).toEqual([
        { path: '/es', visits: 2 },
        { path: '/en/cases', visits: 1 },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // 11.4 admin leads
  // ---------------------------------------------------------------------------

  describe('admin leads', () => {
    async function seedLeads() {
      const conversation = await prisma.conversation.create({
        data: { visitorId: 'v-1', locale: 'ES', hasLead: true },
      });
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'USER',
          content: '¿Hacen tiendas online?',
        },
      });
      const chat = await prisma.lead.create({
        data: {
          source: 'CHAT_IA',
          name: 'Bruno Díaz',
          email: 'bruno@example.com',
          interest: 'Ecommerce',
          conversationId: conversation.id,
          createdAt: new Date(Date.now() - 60_000),
        },
      });
      await prisma.meeting.create({
        data: {
          leadId: chat.id,
          conversationId: conversation.id,
          start: new Date(Date.now() + 86_400_000),
          end: new Date(Date.now() + 86_400_000 + 1_800_000),
          timezone: 'America/Lima',
          status: 'REQUESTED',
        },
      });
      const form = await prisma.lead.create({
        data: {
          source: 'FORM',
          name: 'Ana Torres',
          email: 'ana@example.com',
          status: 'CONTACTED',
          message: 'Clínica',
        },
      });
      await prisma.lead.create({
        data: {
          source: 'FORM',
          name: 'Borrado',
          email: 'x@example.com',
          deletedAt: new Date(),
        },
      });
      return { chat, form, conversation };
    }

    it('lists with filters, sort and countsByStatus', async () => {
      const { chat, form } = await seedLeads();

      const all = await http()
        .get('/api/v1/admin/leads')
        .set(editor)
        .expect(200);
      expect(all.body.data.map((l: { id: string }) => l.id)).toEqual([
        form.id,
        chat.id,
      ]);
      expect(all.body.meta).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        countsByStatus: { NEW: 1, CONTACTED: 1, PROPOSAL: 0, WON: 0, LOST: 0 },
      });
      const chatItem = all.body.data[1];
      expect(chatItem).toMatchObject({
        source: 'CHAT_IA',
        conversationId: chat.conversationId,
        hasMeeting: true,
        nextMeetingAt: expect.any(String),
      });
      expect(chatItem).not.toHaveProperty('message');

      const filtered = await http()
        .get(
          '/api/v1/admin/leads?status=NEW&source=CHAT_IA&q=BRUNO&sort=name&order=asc',
        )
        .set(editor)
        .expect(200);
      expect(filtered.body.data).toHaveLength(1);
      // Counts ignore status but honour source and q.
      expect(filtered.body.meta.countsByStatus).toMatchObject({
        NEW: 1,
        CONTACTED: 0,
      });

      await http()
        .get('/api/v1/admin/leads?sort=email')
        .set(editor)
        .expect(400);
      await http().get('/api/v1/admin/leads').expect(401);
    });

    it('detail has meetings and the conversation; PATCH updates status and notes', async () => {
      const { chat, form } = await seedLeads();

      const detail = await http()
        .get(`/api/v1/admin/leads/${chat.id}`)
        .set(editor)
        .expect(200);
      expect(detail.body.meetings).toHaveLength(1);
      expect(detail.body.conversation.messages).toEqual([
        expect.objectContaining({
          role: 'USER',
          content: '¿Hacen tiendas online?',
          sources: [],
        }),
      ]);
      const formDetail = await http()
        .get(`/api/v1/admin/leads/${form.id}`)
        .set(editor)
        .expect(200);
      expect(formDetail.body).toMatchObject({
        conversation: null,
        message: 'Clínica',
        notes: null,
      });

      const patched = await http()
        .patch(`/api/v1/admin/leads/${form.id}`)
        .set(editor)
        .send({ status: 'WON', notes: 'Firmó el contrato' })
        .expect(200);
      expect(patched.body).toMatchObject({
        status: 'WON',
        notes: 'Firmó el contrato',
      });
      const cleared = await http()
        .patch(`/api/v1/admin/leads/${form.id}`)
        .set(editor)
        .send({ notes: '' })
        .expect(200);
      expect(cleared.body).toMatchObject({ status: 'WON', notes: null });

      await http()
        .patch(`/api/v1/admin/leads/${form.id}`)
        .set(editor)
        .send({ status: 'DONE' })
        .expect(400);
      await http()
        .patch(`/api/v1/admin/leads/${form.id}`)
        .set(editor)
        .send({ notes: 'x'.repeat(5001) })
        .expect(400);
      await http().get('/api/v1/admin/leads/nope').set(editor).expect(404);
    });

    it('DELETE is ADMIN only and soft-deletes the lead everywhere', async () => {
      const { chat, conversation } = await seedLeads();

      await http()
        .delete(`/api/v1/admin/leads/${chat.id}`)
        .set(editor)
        .expect(403);
      await http()
        .delete(`/api/v1/admin/leads/${chat.id}`)
        .set(admin)
        .expect(204);
      await http()
        .delete(`/api/v1/admin/leads/${chat.id}`)
        .set(admin)
        .expect(404);
      await http()
        .get(`/api/v1/admin/leads/${chat.id}`)
        .set(editor)
        .expect(404);

      const list = await http()
        .get('/api/v1/admin/leads')
        .set(editor)
        .expect(200);
      expect(list.body.meta.total).toBe(1);
      const search = await http()
        .get('/api/v1/admin/search?q=bruno')
        .set(editor)
        .expect(200);
      expect(search.body.leads).toEqual([]);
      const updated = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(updated.hasLead).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 11.5 settings
  // ---------------------------------------------------------------------------

  describe('settings', () => {
    it('GET /settings is public and cacheable, with hours and time zone', async () => {
      const res = await http().get('/api/v1/settings').expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=60');
      expect(res.body).toEqual({
        contactEmail: SETTINGS.contactEmail,
        whatsapp: SETTINGS.whatsapp,
        socialLinks: SETTINGS.socialLinks,
        businessHours: SETTINGS.businessHours,
        timezone: 'America/Lima',
      });
    });

    it('GET /admin/settings for editors; PUT only for admins, validated', async () => {
      const res = await http()
        .get('/api/v1/admin/settings')
        .set(editor)
        .expect(200);
      expect(res.body).toMatchObject({
        ...SETTINGS,
        updatedAt: expect.any(String),
      });

      const body = {
        ...SETTINGS,
        whatsapp: '+51 911-222-333',
        socialLinks: {
          ...SETTINGS.socialLinks,
          github: 'https://github.com/miwebprofesional',
        },
        businessHours: {
          ...SETTINGS.businessHours,
          sat: [{ start: '09:00', end: '13:00' }],
        },
        timezone: 'America/Bogota',
        meetingDurationMinutes: 45,
      };
      await http()
        .put('/api/v1/admin/settings')
        .set(editor)
        .send(body)
        .expect(403);
      const saved = await http()
        .put('/api/v1/admin/settings')
        .set(admin)
        .send(body)
        .expect(200);
      expect(saved.body).toMatchObject({
        whatsapp: '51911222333',
        timezone: 'America/Bogota',
        meetingDurationMinutes: 45,
      });
      expect(saved.body.businessHours.sat).toEqual([
        { start: '09:00', end: '13:00' },
      ]);

      const invalid = await http()
        .put('/api/v1/admin/settings')
        .set(admin)
        .send({ ...body, timezone: 'Nowhere/City', meetingDurationMinutes: 50 })
        .expect(400);
      expect(invalid.body.message).toEqual(
        expect.arrayContaining([
          'meetingDurationMinutes debe ser múltiplo de 15',
        ]),
      );
      expect(invalid.body.details.fields.sort()).toEqual([
        'meetingDurationMinutes',
        'timezone',
      ]);
      // The calendar reads the new settings at once.
      const row = await prisma.siteSettings.findUniqueOrThrow({
        where: { id: 'default' },
      });
      expect(row.timezone).toBe('America/Bogota');
    });
  });

  // ---------------------------------------------------------------------------
  // 11.6 users and POST /auth/password
  // ---------------------------------------------------------------------------

  describe('users', () => {
    const PASSWORD = 'e2e-Password-1234';
    let hash: string;

    beforeAll(async () => {
      hash = await hashPassword(PASSWORD);
    });

    async function seedUsers() {
      const boss = await prisma.user.create({
        data: {
          email: 'boss@miwebprofesional.com',
          name: 'Boss',
          role: 'ADMIN',
          passwordHash: hash,
        },
      });
      const ed = await prisma.user.create({
        data: {
          email: 'ed@miwebprofesional.com',
          name: 'Ed',
          role: 'EDITOR',
          passwordHash: hash,
        },
      });
      return {
        boss,
        ed,
        asBoss: sign(boss.id, 'ADMIN'),
        asEd: sign(ed.id, 'EDITOR'),
      };
    }

    it('lists and creates users (ADMIN only), never exposing the hash', async () => {
      const { asBoss, asEd } = await seedUsers();

      await http().get('/api/v1/admin/users').set(asEd).expect(403);
      const list = await http()
        .get('/api/v1/admin/users')
        .set(asBoss)
        .expect(200);
      expect(list.body.data.map((u: { name: string }) => u.name)).toEqual([
        'Boss',
        'Ed',
      ]);
      expect(list.body.data[0]).not.toHaveProperty('passwordHash');

      const created = await http()
        .post('/api/v1/admin/users')
        .set(asBoss)
        .send({
          email: 'Nueva@MiWebProfesional.com',
          name: 'Nueva',
          role: 'EDITOR',
          password: 'a-long-password-1',
        })
        .expect(201);
      expect(created.body).toMatchObject({
        email: 'nueva@miwebprofesional.com',
        isActive: true,
        lastLoginAt: null,
      });
      expect(created.body).not.toHaveProperty('passwordHash');

      const taken = await http()
        .post('/api/v1/admin/users')
        .set(asBoss)
        .send({
          email: 'nueva@miwebprofesional.com',
          name: 'Otra',
          role: 'EDITOR',
          password: 'a-long-password-1',
        })
        .expect(409);
      expect(taken.body.details).toEqual({ reason: 'email_taken' });
      await http()
        .post('/api/v1/admin/users')
        .set(asBoss)
        .send({ email: 'x@y.com', name: 'X', role: 'OWNER', password: 'short' })
        .expect(400);
    });

    it('422 self_change and last_admin', async () => {
      const { boss, ed, asBoss } = await seedUsers();

      const self = await http()
        .patch(`/api/v1/admin/users/${boss.id}`)
        .set(asBoss)
        .send({ role: 'EDITOR' })
        .expect(422);
      expect(self.body).toMatchObject({
        statusCode: 422,
        details: { reason: 'self_change' },
      });
      await http()
        .patch(`/api/v1/admin/users/${boss.id}`)
        .set(asBoss)
        .send({ name: 'Jefe' })
        .expect(200);

      // Ed (now an ADMIN) tries to demote the only other active admin after Boss is gone.
      await http()
        .patch(`/api/v1/admin/users/${ed.id}`)
        .set(asBoss)
        .send({ role: 'ADMIN' })
        .expect(200);
      const asEdAdmin = sign(ed.id, 'ADMIN');
      await http()
        .patch(`/api/v1/admin/users/${boss.id}`)
        .set(asEdAdmin)
        .send({ isActive: false })
        .expect(200);
      const last = await http()
        .patch(`/api/v1/admin/users/${ed.id}`)
        .set(asBoss)
        .send({ role: 'EDITOR' })
        .expect(422);
      expect(last.body.details).toEqual({ reason: 'last_admin' });
      await http()
        .patch('/api/v1/admin/users/nope')
        .set(asBoss)
        .send({ name: 'X Y' })
        .expect(404);
    });

    it('deactivation and password reset revoke the sessions; a deactivated user cannot log in', async () => {
      const { ed, asBoss } = await seedUsers();
      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email: ed.email, password: PASSWORD })
        .expect(200);

      await http()
        .patch(`/api/v1/admin/users/${ed.id}`)
        .set(asBoss)
        .send({ isActive: false })
        .expect(200);
      expect(
        await prisma.refreshToken.count({
          where: { userId: ed.id, revokedAt: null },
        }),
      ).toBe(0);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(401);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: ed.email, password: PASSWORD })
        .expect(401);

      await http()
        .patch(`/api/v1/admin/users/${ed.id}`)
        .set(asBoss)
        .send({ isActive: true })
        .expect(200);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: ed.email, password: PASSWORD })
        .expect(200);
      await http()
        .post(`/api/v1/admin/users/${ed.id}/password`)
        .set(asBoss)
        .send({ password: 'a-brand-new-password' })
        .expect(204);
      expect(
        await prisma.refreshToken.count({
          where: { userId: ed.id, revokedAt: null },
        }),
      ).toBe(0);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: ed.email, password: 'a-brand-new-password' })
        .expect(200);
      await http()
        .post(`/api/v1/admin/users/${ed.id}/password`)
        .set(asBoss)
        .send({ password: 'short' })
        .expect(400);
    });

    it('POST /auth/password keeps the calling session and revokes the others', async () => {
      const { ed } = await seedUsers();
      const first = await http()
        .post('/api/v1/auth/login')
        .send({ email: ed.email, password: PASSWORD })
        .expect(200);
      const second = await http()
        .post('/api/v1/auth/login')
        .send({ email: ed.email, password: PASSWORD })
        .expect(200);
      const auth = bearer(second.body.accessToken);

      const wrong = await http()
        .post('/api/v1/auth/password')
        .set(auth)
        .send({ currentPassword: 'nope', newPassword: 'another-password-1' })
        .expect(400);
      expect(wrong.body.details).toEqual({ reason: 'invalid_password' });
      await http()
        .post('/api/v1/auth/password')
        .set(auth)
        .send({ currentPassword: PASSWORD, newPassword: 'short' })
        .expect(400);

      await http()
        .post('/api/v1/auth/password')
        .set(auth)
        .send({ currentPassword: PASSWORD, newPassword: 'another-password-1' })
        .expect(204);

      // Checked in the database: presenting the revoked token would trigger the
      // reuse detection, which revokes every session.
      const active = await prisma.refreshToken.findMany({
        where: { userId: ed.id, revokedAt: null },
      });
      expect(active).toHaveLength(1);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: second.body.refreshToken })
        .expect(200);
      expect(first.body.refreshToken).not.toBe(second.body.refreshToken);
      await http()
        .post('/api/v1/auth/password')
        .send({ currentPassword: 'a', newPassword: 'b' })
        .expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // 11.7 global search
  // ---------------------------------------------------------------------------

  it('GET /admin/search finds cases, posts, leads and conversations', async () => {
    const caseId = await createCase(prisma, {
      type: 'SAAS',
      translations: {
        ES: { title: 'ContaFlow IA', slug: 'contaflow-ia' },
        EN: { title: 'ContaFlow AI', slug: 'contaflow-ai' },
      },
    });
    await createCase(prisma, {
      deleted: true,
      translations: {
        ES: { title: 'ContaFlow viejo', slug: 'contaflow-viejo' },
      },
    });
    const postId = await createBlogPost(prisma, {
      translations: {
        EN: { title: 'Why ContaFlow works', slug: 'why-contaflow' },
      },
    });
    const lead = await prisma.lead.create({
      data: { source: 'FORM', name: 'Ana', email: 'ana@contaflow.pe' },
    });
    const conversation = await prisma.conversation.create({
      data: { visitorId: 'v', locale: 'ES' },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: '¿Qué es contaflow?',
      },
    });

    const res = await http()
      .get('/api/v1/admin/search?q=%20contaflow%20')
      .set(editor)
      .expect(200);
    expect(res.body).toEqual({
      cases: [{ id: caseId, title: 'ContaFlow IA', type: 'SAAS' }],
      blogPosts: [{ id: postId, title: 'Why ContaFlow works' }],
      leads: [
        { id: lead.id, name: 'Ana', email: 'ana@contaflow.pe', status: 'NEW' },
      ],
      conversations: [
        {
          id: conversation.id,
          firstQuestion: '¿Qué es contaflow?',
          lastMessageAt: expect.any(String),
        },
      ],
    });
    await http().get('/api/v1/admin/search?q=%20a%20').set(editor).expect(400);
    await http().get('/api/v1/admin/search').set(editor).expect(400);
    await http()
      .get(`/api/v1/admin/search?q=${'a'.repeat(101)}`)
      .set(editor)
      .expect(400);
  });
});
