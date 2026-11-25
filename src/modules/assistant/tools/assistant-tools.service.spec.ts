import type Anthropic from '@anthropic-ai/sdk';
import type { MeetingsService } from '../../calendar/meetings.service.js';
import { DEFAULT_BUSINESS_HOURS } from '../../calendar/business-hours.js';
import type { KnowledgeSearchService } from '../../knowledge/knowledge-search.service.js';
import type { ChatLeadsService } from '../../leads/chat-leads.service.js';
import { AssistantToolsService, describeBusinessHours } from './assistant-tools.service.js';

type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;
const use = (name: string, input: unknown): ToolUse =>
  ({ type: 'tool_use', id: 'tu_1', name, input }) as ToolUse;

describe('AssistantToolsService', () => {
  const search = { search: vi.fn() };
  const leads = { upsert: vi.fn() };
  const meetings = { schedule: vi.fn(), settings: vi.fn() };
  const context = { conversationId: 'conv-1', locale: 'ES' as const, caseSlug: 'contaflow-ia' };
  let tools: AssistantToolsService;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = new AssistantToolsService(
      search as unknown as KnowledgeSearchService,
      leads as unknown as ChatLeadsService,
      meetings as unknown as MeetingsService,
    );
    leads.upsert.mockResolvedValue({
      lead: { id: 'lead-1', email: 'ana@example.com' },
      created: true,
    });
    meetings.settings.mockResolvedValue({
      hours: DEFAULT_BUSINESS_HOURS,
      timeZone: 'America/Lima',
      durationMinutes: 30,
    });
  });

  describe('input validation (eager streaming skips the API validation)', () => {
    it.each([
      ['buscar_casos', { query: '' }],
      ['buscar_casos', { query: 'x', extra: 1 }],
      ['buscar_casos', { query: 'x', tipo: 'BLOG' }],
      ['crear_lead', { nombre: 'Ana', email: 'a@b.co' }],
      ['agendar_reunion', { nombre: 'Ana' }],
    ])('%s rejects %j as INVALID_JSON without running', async (name, input) => {
      const result = await tools.execute(use(name, input), context);
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content)).toHaveProperty('INVALID_JSON');
      expect(search.search).not.toHaveBeenCalled();
      expect(leads.upsert).not.toHaveBeenCalled();
    });

    it('answers an unknown tool with an error result', async () => {
      const result = await tools.execute(use('borrar_todo', {}), context);
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/no existe/);
    });
  });

  describe('buscar_casos', () => {
    it('passes the locale, the case page and the filters, and returns citable fragments', async () => {
      search.search.mockResolvedValue({
        hits: [
          {
            sourceType: 'CASE', sourceId: 'c1', locale: 'ES', sourceKey: 'caso:contaflow-ia#0',
            title: 'ContaFlow IA', url: '/es/casos/contaflow-ia', content: 'Texto',
            similarity: 0.612, score: 0.712,
          },
        ],
        bestScore: 0.712,
        threshold: 0.45,
        usedOtherLocale: false,
      });

      const result = await tools.execute(
        use('buscar_casos', { query: 'contadores', tipo: 'SAAS', tecnologia: 'Next.js' }),
        context,
      );

      expect(search.search).toHaveBeenCalledWith('contadores', 'ES', {
        caseSlug: 'contaflow-ia',
        type: 'SAAS',
        technology: 'Next.js',
      });
      expect(result.isError).toBe(false);
      expect(result.hits).toHaveLength(1);
      const body = JSON.parse(result.content);
      expect(body.resultados[0]).toEqual({
        fuente: 'caso:contaflow-ia#0',
        titulo: 'ContaFlow IA',
        tipo: 'caso',
        relevancia: 0.71,
        contenido: 'Texto',
      });
      expect(result.record.summary).toMatchObject({
        results: [{ sourceKey: 'caso:contaflow-ia#0', similarity: 0.612 }],
        threshold: 0.45,
      });
    });

    it('tells the model to be honest when nothing is relevant', async () => {
      search.search.mockResolvedValue({ hits: [], bestScore: 0.2, threshold: 0.45, usedOtherLocale: false });
      const result = await tools.execute(use('buscar_casos', { query: 'relojes' }), context);
      expect(result.hits).toEqual([]);
      expect(JSON.parse(result.content).nota).toMatch(/No inventes/);
    });

    it('turns a search failure into an error result', async () => {
      search.search.mockRejectedValue(new Error('Voyage 429'));
      const result = await tools.execute(use('buscar_casos', { query: 'x' }), context);
      expect(result.isError).toBe(true);
      expect(result.hits).toBeUndefined();
    });
  });

  describe('crear_lead', () => {
    const input = {
      nombre: 'Ana',
      email: 'Ana@Example.com',
      interes: 'SaaS para clínicas',
      resumen: 'Quiere una plataforma.',
    };

    it('validates the email before storing anything', async () => {
      const result = await tools.execute(use('crear_lead', { ...input, email: 'ana-at-example' }), context);
      expect(result.isError).toBe(true);
      expect(leads.upsert).not.toHaveBeenCalled();
    });

    it('upserts the lead of the conversation and emits the lead event', async () => {
      const lead = vi.fn();
      const result = await tools.execute(use('crear_lead', input), context, { lead });
      expect(leads.upsert).toHaveBeenCalledWith('conv-1', 'ES', {
        name: 'Ana',
        email: 'Ana@Example.com',
        phone: undefined,
        interest: 'SaaS para clínicas',
        summary: 'Quiere una plataforma.',
      });
      expect(lead).toHaveBeenCalledWith({ created: true });
      expect(result.record.summary).toEqual({ leadId: 'lead-1', created: true });
    });

    it('is disabled in the admin test mode', async () => {
      const result = await tools.execute(use('crear_lead', input), { ...context, conversationId: null });
      expect(result.isError).toBe(true);
      expect(leads.upsert).not.toHaveBeenCalled();
    });
  });

  describe('agendar_reunion', () => {
    const input = {
      nombre: 'Ana',
      email: 'ana@example.com',
      fecha_hora_preferida: '2026-11-25T10:00',
      zona_horaria: 'America/Bogota',
      motivo: 'Plataforma SaaS',
    };

    it.each([
      [{ zona_horaria: 'Bogota' }, /zona horaria/],
      [{ fecha_hora_preferida: 'mañana a las 10' }, /formato/],
      [{ email: 'nope' }, /email/],
    ])('rejects %j', async (patch, message) => {
      const result = await tools.execute(use('agendar_reunion', { ...input, ...patch }), context);
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(message);
      expect(meetings.schedule).not.toHaveBeenCalled();
    });

    it('converts the visitor time to UTC, keeps the lead data, and confirms in both zones', async () => {
      const start = new Date('2026-11-25T15:00:00Z'); // 10:00 Bogotá = 10:00 Lima
      meetings.schedule.mockResolvedValue({
        status: 'BOOKED', meetingId: 'm1', start, end: new Date(start.getTime() + 1_800_000),
        meetLink: 'https://meet.google.com/x',
      });
      const events = { lead: vi.fn(), meeting: vi.fn() };

      const result = await tools.execute(use('agendar_reunion', input), context, events);

      expect(leads.upsert).toHaveBeenCalledWith(
        'conv-1',
        'ES',
        expect.objectContaining({ name: 'Ana', interest: 'Plataforma SaaS' }),
        { fillOnly: true },
      );
      expect(meetings.schedule).toHaveBeenCalledWith(
        expect.objectContaining({ start, visitorTimeZone: 'America/Bogota', leadId: 'lead-1' }),
      );
      const body = JSON.parse(result.content);
      expect(body.estado).toBe('CONFIRMADA');
      expect(body.hora_visitante).toMatch(/10:00.*America\/Bogota/);
      expect(body.hora_estudio).toMatch(/10:00.*America\/Lima/);
      expect(body.enlace_meet).toBe('https://meet.google.com/x');
      expect(events.meeting).toHaveBeenCalledWith({
        status: 'BOOKED',
        start: '2026-11-25T15:00:00.000Z',
        meetLink: 'https://meet.google.com/x',
      });
    });

    it('returns alternatives with the value to book them again, in the visitor zone', async () => {
      meetings.schedule.mockResolvedValue({
        status: 'UNAVAILABLE',
        reason: 'busy',
        alternatives: [new Date('2026-11-25T16:00:00Z')],
      });
      const meeting = vi.fn();

      const result = await tools.execute(
        use('agendar_reunion', { ...input, zona_horaria: 'Europe/Madrid' }),
        context,
        { meeting },
      );

      const body = JSON.parse(result.content);
      expect(body.estado).toBe('NO_DISPONIBLE');
      expect(body.motivo).toBe('ocupado');
      expect(body.alternativas[0].fecha_hora_para_agendar).toBe('2026-11-25T17:00');
      expect(body.horario_laboral).toContain('domingo: cerrado');
      expect(meeting).not.toHaveBeenCalled();
    });
  });

  it('describeBusinessHours lists Monday first and Sunday closed', () => {
    expect(describeBusinessHours(DEFAULT_BUSINESS_HOURS)).toBe(
      'lunes: 08:00-19:00; martes: 08:00-19:00; miércoles: 08:00-19:00; jueves: 08:00-19:00; viernes: 08:00-19:00; sábado: 08:00-19:00; domingo: cerrado',
    );
  });
});
