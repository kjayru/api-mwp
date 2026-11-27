import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  buildLeadEmail,
  escapeHtml,
  type LeadEmailData,
} from './lead-email.js';
import type { MailMessage, MailTransport } from './mail-transport.js';
import { NotificationsService } from './notifications.service.js';

const lead: LeadEmailData = {
  id: 'lead-1',
  source: 'FORM',
  name: 'Ana <script>alert(1)</script>',
  email: 'ana@example.com',
  phone: '+51 987 654 321',
  interest: 'Plataforma SaaS',
  message: 'Empresa: Clínica "Sur" & Co\n\nQueremos <b>citas</b>',
  locale: 'ES',
};

class FakeTransport implements MailTransport {
  sent: MailMessage[] = [];
  impl: (message: MailMessage) => Promise<unknown> = async () => ({});

  sendMail(message: MailMessage): Promise<unknown> {
    this.sent.push(message);
    return this.impl(message);
  }
}

describe('NotificationsService', () => {
  const prisma = {
    siteSettings: {
      findUnique: vi.fn(),
    },
  };
  let transport: FakeTransport;
  const options = {
    from: 'miwebprofesional <no-reply@miwebprofesional.com>',
    adminUrl: 'https://admin.miwebprofesional.com',
    timeoutMs: 50,
  };
  const make = (t: MailTransport | null = transport, o = options) =>
    new NotificationsService(prisma as unknown as PrismaService, t, o);

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new FakeTransport();
    prisma.siteSettings.findUnique.mockResolvedValue({
      contactEmail: 'hola@miwebprofesional.com',
    });
  });

  it('emails contactEmail with the lead data and the admin link', async () => {
    await make().notifyNewLead(lead);

    expect(transport.sent).toHaveLength(1);
    const [message] = transport.sent;
    expect(message.to).toBe('hola@miwebprofesional.com');
    expect(message.from).toBe(options.from);
    expect(message.replyTo).toBe('ana@example.com');
    expect(message.subject).toBe(
      'Nuevo lead (Formulario de contacto): Ana <script>alert(1)</script>',
    );
    expect(message.text).toContain('Teléfono: +51 987 654 321');
    expect(message.text).toContain('Interés: Plataforma SaaS');
    expect(message.text).toContain(
      'Ver en el panel: https://admin.miwebprofesional.com/leads/lead-1',
    );
    expect(message.html).toContain(
      'href="https://admin.miwebprofesional.com/leads/lead-1"',
    );
  });

  it('HTML-escapes every user value', async () => {
    await make().notifyNewLead(lead);

    const { html } = transport.sent[0];
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>citas</b>');
    expect(html).toContain('Ana &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Clínica &quot;Sur&quot; &amp; Co');
  });

  it('labels chat leads and their summary', () => {
    const email = buildLeadEmail(
      { ...lead, source: 'CHAT_IA', phone: null, interest: null },
      'http://localhost:3002',
    );
    expect(email.subject).toMatch(/^Nuevo lead \(Asistente IA\)/);
    expect(email.text).toContain('Teléfono: —');
    expect(email.text).toContain('Resumen:');
  });

  it('only logs when no email provider is configured', async () => {
    await expect(make(null).notifyNewLead(lead)).resolves.toBeUndefined();
    expect(prisma.siteSettings.findUnique).not.toHaveBeenCalled();
  });

  it('skips when there is no contact email', async () => {
    prisma.siteSettings.findUnique.mockResolvedValue(null);
    await make().notifyNewLead(lead);
    expect(transport.sent).toHaveLength(0);
  });

  it('never rejects when sending fails', async () => {
    transport.impl = async () => {
      throw new Error('535 auth failed');
    };
    await expect(make().notifyNewLead(lead)).resolves.toBeUndefined();
  });

  it('gives up after the timeout', async () => {
    transport.impl = () => new Promise(() => undefined);
    const started = Date.now();
    await expect(make().notifyNewLead(lead)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('escapeHtml escapes the five special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
