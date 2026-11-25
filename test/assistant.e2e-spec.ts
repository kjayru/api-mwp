import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { MODEL_CLIENT } from '../src/modules/assistant/model-client.js';
import {
  formatLocalDateTime,
  zonedParts,
} from '../src/modules/calendar/time-zones.js';
import { EMBEDDINGS_PROVIDER } from '../src/modules/knowledge/embeddings/embeddings-provider.js';
import { KnowledgeSyncService } from '../src/modules/knowledge/knowledge-sync.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { accessToken, bearer } from './utils/auth.js';
import { createCase, createTechnology } from './utils/content.js';
import { FakeEmbeddingsProvider } from './utils/fake-embeddings.js';
import { FakeModelClient } from './utils/fake-model-client.js';
import { createTestApp, resetThrottler, truncateAll } from './utils/test-app.js';

interface SseEvent {
  event: string;
  data: any;
}

/** Splits an SSE body into events (keep-alive comments are skipped). */
function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .filter((block) => block.trim() && !block.startsWith(':'))
    .map((block) => {
      const lines = block.split('\n');
      return {
        event: lines.find((l) => l.startsWith('event: '))!.slice(7),
        data: JSON.parse(lines.find((l) => l.startsWith('data: '))!.slice(6)),
      };
    });
}

const VISITOR = 'visitor-0123456789';

describe('Assistant (e2e, mocked Claude and Voyage)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let editor: { Authorization: string };
  const model = new FakeModelClient();
  const embeddings = new FakeEmbeddingsProvider();
  const http = () => request(app.getHttpServer());

  const chat = (body: Record<string, unknown>) =>
    http()
      .post('/api/v1/assistant/chat')
      .send({ visitorId: VISITOR, locale: 'es', ...body })
      .buffer(true)
      .parse((res, done) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => done(null, text));
      });

  async function seedKnowledge() {
    const nest = await createTechnology(prisma, { name: 'NestJS', slug: 'nestjs' });
    await createCase(prisma, {
      type: 'SAAS',
      client: 'Estudio Contable Pérez',
      anonymizeClient: true,
      technologies: [nest],
      translations: {
        ES: {
          title: 'ContaFlow IA',
          slug: 'contaflow-ia',
          summary: 'Plataforma para estudios contables y contadores con cierres mensuales.',
          blocks: [
            {
              type: 'text',
              title: 'El reto',
              body: 'Estudio Contable Pérez gestionaba obligaciones de contadores en hojas de cálculo.',
            },
          ],
        },
      },
    });
    const sync = app.get(KnowledgeSyncService);
    await sync.startFullReindex();
    await sync.idle();
  }

  beforeAll(async () => {
    app = await createTestApp([], (builder) =>
      builder
        .overrideProvider(MODEL_CLIENT)
        .useValue(model)
        .overrideProvider(EMBEDDINGS_PROVIDER)
        .useValue(embeddings),
    );
    prisma = app.get(PrismaService);
    editor = bearer(accessToken(app, 'EDITOR'));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    resetThrottler(app);
    model.reset();
    await seedKnowledge();
  });

  afterAll(async () => {
    await app.get(KnowledgeSyncService).idle();
    await truncateAll(prisma);
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Knowledge base
  // ---------------------------------------------------------------------------

  describe('knowledge base', () => {
    it('indexes published cases without the anonymised client, with an HNSW index', async () => {
      const chunks = await prisma.knowledgeChunk.findMany();
      expect(chunks.map((c) => [c.sourceKey, c.locale, c.url])).toEqual([
        ['caso:contaflow-ia#0', 'ES', '/es/casos/contaflow-ia'],
      ]);
      expect(chunks[0].content).not.toMatch(/Pérez/);
      expect(chunks[0].embeddingModel).toBe('fake-embeddings');
      expect(embeddings.calls.at(-1)?.inputType).toBe('document');

      const index = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes WHERE indexname = 'knowledge_chunks_embedding_hnsw_idx'`;
      expect(index[0].indexdef).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
    });

    it('GET /admin/knowledge/status reports counts, the last run and "Sincronizada"', async () => {
      const { body } = await http()
        .get('/api/v1/admin/knowledge/status')
        .set(editor)
        .expect(200);
      expect(body).toMatchObject({
        state: 'SYNCED',
        label: 'Sincronizada',
        embeddingModel: 'fake-embeddings',
        dimension: 1024,
        totals: { sources: 1, chunks: 1 },
        pending: { count: 0, items: [] },
        lastRun: { status: 'SUCCEEDED', sourcesCount: 1, chunksCount: 1 },
      });
      expect(body.counts).toContainEqual({ sourceType: 'CASE', locale: 'ES', sources: 1, chunks: 1 });
    });

    it('POST /admin/knowledge/reindex answers 202, and 409 while a run is active', async () => {
      const first = await http().post('/api/v1/admin/knowledge/reindex').set(editor).expect(202);
      expect(first.body).toMatchObject({ runId: expect.any(String), status: 'RUNNING' });
      const second = await http().post('/api/v1/admin/knowledge/reindex').set(editor).expect(409);
      expect(second.body).toMatchObject({
        statusCode: 409,
        message: 'Ya hay una reindexación en curso. Espera a que termine.',
      });
      await app.get(KnowledgeSyncService).idle();
      const run = await prisma.indexingRun.findUnique({ where: { id: first.body.runId } });
      expect(run?.status).toBe('SUCCEEDED');
      // Nothing changed: no embedding was recomputed.
      expect(run?.embeddedCount).toBe(0);
    });

    it('reindexes a case when it is unpublished, and a FAQ when it is published', async () => {
      const caseRow = await prisma.case.findFirstOrThrow();
      await http()
        .post(`/api/v1/admin/cases/${caseRow.id}/unpublish`)
        .set(editor)
        .send({ locale: 'ES' })
        .expect(200);
      await app.get(KnowledgeSyncService).idle();
      expect(await prisma.knowledgeChunk.count()).toBe(0);

      const created = await http()
        .post('/api/v1/admin/faqs')
        .set(editor)
        .send({ translations: { ES: { question: '¿Cuánto tarda un proyecto?', answer: 'Depende del alcance.' } } })
        .expect(201);
      await http()
        .post(`/api/v1/admin/faqs/${created.body.id}/publish`)
        .set(editor)
        .send({ locale: 'es' })
        .expect(200);
      await app.get(KnowledgeSyncService).idle();
      const chunks = await prisma.knowledgeChunk.findMany();
      expect(chunks.map((c) => [c.sourceKey, c.url])).toEqual([[`faq:${created.body.id}#0`, null]]);
    });
  });

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  describe('POST /api/v1/assistant/chat', () => {
    it('streams the answer as SSE, in order, and stores the conversation', async () => {
      model.script(
        { toolUses: [{ id: 'tu_1', name: 'buscar_casos', input: { query: 'sistemas para contadores' } }] },
        {
          text: ['Sí: ContaFlow IA es una plataforma ', 'para estudios contables [caso:contaflow-ia#0].'],
          usage: { input_tokens: 50, output_tokens: 30, cache_read_input_tokens: 1200 },
        },
      );

      const res = await chat({ message: '¿Tienen experiencia con sistemas para contadores?' }).expect(200);

      expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-accel-buffering']).toBe('no');
      const events = parseSse(res.body as string);
      expect(events.map((e) => e.event)).toEqual([
        'conversation',
        'tool',
        'tool',
        'delta',
        'delta',
        'sources',
        'done',
      ]);
      const conversationId = events[0].data.conversationId;
      expect(events[1].data).toEqual({ name: 'buscar_casos', status: 'started' });
      expect(events[2].data).toEqual({ name: 'buscar_casos', status: 'completed' });
      const text = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
      expect(text).toBe('Sí: ContaFlow IA es una plataforma para estudios contables.');
      expect(events[5].data).toEqual([
        { sourceKey: 'caso:contaflow-ia#0', title: 'ContaFlow IA', url: '/es/casos/contaflow-ia' },
      ]);
      expect(events[6].data).toMatchObject({
        messageId: expect.any(String),
        stopReason: 'end_turn',
        unanswered: false,
        content: text,
        usage: { inputTokens: 150, outputTokens: 50, cacheReadInputTokens: 1200, requests: 2 },
      });

      // The search really ran against pgvector: the tool result holds the chunk.
      const toolResult = model.requests[1].messages.at(-1) as any;
      expect(toolResult.content[0].content).toContain('caso:contaflow-ia#0');
      expect(embeddings.calls.at(-1)).toEqual({
        texts: ['sistemas para contadores'],
        inputType: 'query',
      });

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      expect(conversation).toMatchObject({
        visitorId: VISITOR,
        locale: 'ES',
        messageCount: 2,
        unanswered: false,
        hasLead: false,
      });
      expect(conversation.ipHash).toMatch(/^[0-9a-f]{32}$/);
      const [user, assistant] = conversation.messages;
      expect(user).toMatchObject({ role: 'USER', content: '¿Tienen experiencia con sistemas para contadores?', locale: 'ES' });
      expect(user.context).toMatch(/^<contexto>\nidioma_del_sitio: es\nfecha_actual: /);
      expect(assistant).toMatchObject({
        role: 'ASSISTANT',
        content: text,
        model: 'claude-sonnet-5-5',
        stopReason: 'end_turn',
        sources: [{ sourceKey: 'caso:contaflow-ia#0', title: 'ContaFlow IA', url: '/es/casos/contaflow-ia' }],
        usage: { inputTokens: 150, outputTokens: 50, cacheReadInputTokens: 1200, cacheCreationInputTokens: 0, requests: 2 },
      });
      expect(assistant.toolCalls).toEqual([
        expect.objectContaining({ name: 'buscar_casos', status: 'completed', input: { query: 'sistemas para contadores' } }),
      ]);

      // The request followed the caching order and the model rules.
      const first = model.requests[0];
      expect(first).toMatchObject({
        model: 'claude-sonnet-5-5',
        output_config: { effort: 'low' },
        fallbacks: 'default',
        cache_control: { type: 'ephemeral' },
      });
      expect(first).not.toHaveProperty('temperature');
      expect(first.system).toEqual([
        expect.objectContaining({ cache_control: { type: 'ephemeral' } }),
      ]);
    });

    it('replays the history on the next message of the same conversation', async () => {
      model.script({ text: ['Hola, ¿en qué te ayudo?'] }, { text: ['Claro.'] });
      const first = parseSse((await chat({ message: 'Hola' }).expect(200)).body);
      const conversationId = first[0].data.conversationId;

      const second = parseSse(
        (await chat({ conversationId, message: '¿Y en inglés?', locale: 'en' }).expect(200)).body,
      );

      expect(second[0].data.conversationId).toBe(conversationId);
      const messages = model.requests[1].messages;
      expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(messages[1].content).toBe('Hola, ¿en qué te ayudo?');
      expect(messages[2].content).toMatch(/idioma_del_sitio: en[\s\S]*¿Y en inglés\?$/);
      // Byte-identical prefix: the first user turn is replayed as it was sent.
      expect(messages[0]).toEqual(model.requests[0].messages[0]);
    });

    it('prioritises the case of the page with caseSlug', async () => {
      model.script({ text: ['Duró unas semanas.'] });
      await chat({ message: '¿Cuánto duró?', caseSlug: 'contaflow-ia' }).expect(200);
      const conversation = await prisma.conversation.findFirstOrThrow();
      expect(conversation.caseSlug).toBe('contaflow-ia');
      expect(model.requests[0].messages[0].content).toMatch(/pagina: caso "ContaFlow IA" \(contaflow-ia\)/);
    });

    it('marks the question "sin respuesta" when nothing relevant is found', async () => {
      model.script(
        { toolUses: [{ id: 'tu_1', name: 'buscar_casos', input: { query: 'apps para relojes inteligentes' } }] },
        { text: ['No tenemos casos de relojes inteligentes. ¿Quieres hablar con el equipo?'] },
      );

      const events = parseSse((await chat({ message: '¿Hacen apps para relojes inteligentes?' }).expect(200)).body);

      expect(events.find((e) => e.event === 'sources')?.data).toEqual([]);
      expect(events.at(-1)).toMatchObject({ event: 'done', data: { unanswered: true } });
      const conversation = await prisma.conversation.findFirstOrThrow({ include: { messages: true } });
      expect(conversation.unanswered).toBe(true);
      expect(conversation.messages.find((m) => m.role === 'USER')?.unanswered).toBe(true);

      const unanswered = await http().get('/api/v1/admin/assistant/unanswered?days=7').set(editor).expect(200);
      expect(unanswered.body).toMatchObject({
        days: 7,
        count: 1,
        questions: [{ question: '¿Hacen apps para relojes inteligentes?', conversationId: conversation.id }],
      });
    });

    it('creates the lead once per conversation (crear_lead) and emits the lead event', async () => {
      const leadInput = {
        nombre: 'Ana Torres',
        email: 'ana@example.com',
        interes: 'Plataforma SaaS',
        resumen: 'Quiere una plataforma para su estudio.',
      };
      model.script(
        { toolUses: [{ id: 'tu_1', name: 'crear_lead', input: leadInput }] },
        { text: ['¡Listo! El equipo te escribirá.'] },
        { toolUses: [{ id: 'tu_2', name: 'crear_lead', input: { ...leadInput, telefono: '+51 999 999 999' } }] },
        { text: ['Actualicé tus datos.'] },
      );

      const first = parseSse((await chat({ message: 'Soy Ana, ana@example.com, quiero una propuesta' }).expect(200)).body);
      expect(first.find((e) => e.event === 'lead')?.data).toEqual({ created: true });
      const conversationId = first[0].data.conversationId;
      const second = parseSse((await chat({ conversationId, message: 'Mi teléfono es +51 999 999 999' }).expect(200)).body);
      expect(second.find((e) => e.event === 'lead')?.data).toEqual({ created: false });

      const leads = await prisma.lead.findMany();
      expect(leads).toHaveLength(1);
      expect(leads[0]).toMatchObject({
        source: 'CHAT_IA',
        conversationId,
        locale: 'ES',
        name: 'Ana Torres',
        email: 'ana@example.com',
        phone: '+51 999 999 999',
      });
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).hasLead).toBe(true);
    });

    it('stores a REQUESTED meeting when Google Calendar is not configured', async () => {
      // Next Monday-Saturday at least two days ahead, 10:00 in Lima.
      let day = new Date(Date.now() + 2 * 86_400_000);
      if (zonedParts(day, 'America/Lima').weekday === 0) day = new Date(day.getTime() + 86_400_000);
      const local = `${formatLocalDateTime(day, 'America/Lima').slice(0, 10)}T10:00`;
      model.script(
        {
          toolUses: [
            {
              id: 'tu_1',
              name: 'agendar_reunion',
              input: {
                nombre: 'Ana',
                email: 'ana@example.com',
                fecha_hora_preferida: local,
                zona_horaria: 'America/Lima',
                motivo: 'Plataforma SaaS',
              },
            },
          ],
        },
        { text: ['Registré tu solicitud; el equipo la confirmará por email.'] },
      );

      const events = parseSse((await chat({ message: 'Quiero una llamada' }).expect(200)).body);

      const meeting = events.find((e) => e.event === 'meeting');
      expect(meeting?.data).toMatchObject({ status: 'REQUESTED', meetLink: null });
      const stored = await prisma.meeting.findFirstOrThrow({ include: { lead: true } });
      expect(stored).toMatchObject({ status: 'REQUESTED', timezone: 'America/Lima', googleEventId: null });
      expect(stored.start.toISOString()).toBe(meeting?.data.start);
      expect(stored.lead).toMatchObject({ email: 'ana@example.com', source: 'CHAT_IA' });
      const toolResult = JSON.parse((model.requests[1].messages.at(-1) as any).content[0].content);
      expect(toolResult.estado).toBe('SOLICITADA');
    });

    it('answers 404 for a conversation of another visitor (shared error format)', async () => {
      model.script({ text: ['Hola.'] });
      const first = parseSse((await chat({ message: 'Hola' }).expect(200)).body);
      const conversationId = first[0].data.conversationId;

      const res = await chat({ conversationId, visitorId: 'another-visitor-01', message: 'Hola', locale: 'en' })
        .expect(404);
      expect(JSON.parse(res.body)).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        message: 'Conversation not found',
        path: '/api/v1/assistant/chat',
      });
      await chat({ conversationId: 'cmnotarealconversation01', message: 'Hola' }).expect(404);
    });

    it('answers 429 past maxMessagesPerSession', async () => {
      await http()
        .put('/api/v1/admin/assistant/settings')
        .set(editor)
        .send({
          model: 'claude-sonnet-5-5',
          effort: 'low',
          instructions: 'Eres el asistente.',
          enabledTools: ['buscar_casos'],
          maxMessagesPerSession: 1,
        })
        .expect(200);
      model.script({ text: ['Hola.'] });
      const first = parseSse((await chat({ message: 'Hola' }).expect(200)).body);

      const res = await chat({ conversationId: first[0].data.conversationId, message: 'Otra', locale: 'en' }).expect(429);

      expect(JSON.parse(res.body)).toMatchObject({
        statusCode: 429,
        error: 'Too Many Requests',
        message: expect.stringMatching(/limit of 1 messages/),
        details: { reason: 'session_limit', limit: 1 },
      });
      expect(model.requests).toHaveLength(1);
    });

    it('rate-limits to 10 messages per minute per visitor', async () => {
      for (let i = 0; i < 10; i++) {
        model.script({ text: ['Ok.'] });
        await chat({ message: `Mensaje ${i}` }).expect(200);
      }
      const res = await chat({ message: 'Uno más' }).expect(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(JSON.parse(res.body)).toMatchObject({
        statusCode: 429,
        message: 'Demasiados mensajes seguidos. Espera un minuto y vuelve a intentarlo.',
        details: { reason: 'rate_limit' },
      });
    });

    it('validates the body (400) and answers 503 without an API key', async () => {
      const invalid = await chat({ visitorId: 'x', message: '' }).expect(400);
      expect(JSON.parse(invalid.body).message).toEqual(
        expect.arrayContaining([expect.stringMatching(/visitorId/), 'message no debe estar vacío']),
      );
      await chat({ message: 'a'.repeat(1001) }).expect(400);
      await chat({ message: 'Hola', locale: 'ES' }).expect(400);
      await chat({ message: 'Hola', extra: true }).expect(400);

      model.configured = false;
      const unavailable = await chat({ message: 'Hola' }).expect(503);
      expect(JSON.parse(unavailable.body).message).toBe(
        'El asistente no está disponible en este momento. Inténtalo de nuevo en unos minutos.',
      );
    });

    it('reports model errors as an error event and stores them', async () => {
      model.script({ error: new Error('boom') }, { error: new Error('boom') }, { error: new Error('boom') });
      const events = parseSse((await chat({ message: 'Hola' }).expect(200)).body);
      expect(events.map((e) => e.event)).toEqual(['conversation', 'error']);
      expect(events[1].data.message).toMatch(/no está disponible/);
      const assistant = await prisma.message.findFirstOrThrow({ where: { role: 'ASSISTANT' } });
      expect(assistant.stopReason).toBe('error');
    });

    it('allows the front origin (CORS preflight)', async () => {
      const res = await http()
        .options('/api/v1/assistant/chat')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });
  });

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  describe('admin endpoints', () => {
    const adminRoutes: [string, string][] = [
      ['get', '/api/v1/admin/conversations'],
      ['get', '/api/v1/admin/assistant/settings'],
      ['put', '/api/v1/admin/assistant/settings'],
      ['post', '/api/v1/admin/assistant/test'],
      ['get', '/api/v1/admin/assistant/unanswered'],
      ['get', '/api/v1/admin/knowledge/status'],
      ['post', '/api/v1/admin/knowledge/reindex'],
      ['get', '/api/v1/admin/faqs'],
      ['get', '/api/v1/admin/stats/overview'],
    ];

    it.each(adminRoutes)('%s %s: 401 without a token, 403 for a role that is not ADMIN/EDITOR', async (method, path) => {
      await (http() as any)[method](path).expect(401);
      const viewer = bearer(accessToken(app, 'VIEWER' as never));
      const res = await (http() as any)[method](path).set(viewer).expect(403);
      expect(res.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });
    });

    it('lists conversations with filters, the first question and the lead', async () => {
      model.script(
        { toolUses: [{ id: 'tu_1', name: 'crear_lead', input: { nombre: 'Ana', email: 'ana@example.com', interes: 'SaaS', resumen: 'R' } }] },
        { text: ['Listo.'] },
        { text: ['Hola.'] },
      );
      await chat({ message: 'Quiero una propuesta' }).expect(200);
      await chat({ message: 'Solo miro', visitorId: 'other-visitor-123' }).expect(200);

      const all = await http().get('/api/v1/admin/conversations').set(editor).expect(200);
      expect(all.body.meta).toEqual({ page: 1, limit: 20, total: 2 });
      const leads = await http().get('/api/v1/admin/conversations?filter=lead').set(editor).expect(200);
      expect(leads.body.data).toEqual([
        expect.objectContaining({
          firstQuestion: 'Quiero una propuesta',
          hasLead: true,
          messageCount: 2,
          lead: expect.objectContaining({ name: 'Ana', email: 'ana@example.com', status: 'NEW' }),
        }),
      ]);
      const search = await http().get('/api/v1/admin/conversations?q=miro').set(editor).expect(200);
      expect(search.body.data.map((c: any) => c.firstQuestion)).toEqual(['Solo miro']);
      await http().get('/api/v1/admin/conversations?filter=nope').set(editor).expect(400);

      const detail = await http().get(`/api/v1/admin/conversations/${leads.body.data[0].id}`).set(editor).expect(200);
      expect(detail.body.messages.map((m: any) => m.role)).toEqual(['USER', 'ASSISTANT']);
      expect(detail.body.messages[1].toolCalls[0]).toMatchObject({ name: 'crear_lead', status: 'completed' });
      expect(detail.body.lead).toMatchObject({ email: 'ana@example.com' });
      expect(detail.body).not.toHaveProperty('ipHash');
      await http().get('/api/v1/admin/conversations/nope').set(editor).expect(404);
    });

    it('reads and validates the assistant settings', async () => {
      const current = await http().get('/api/v1/admin/assistant/settings').set(editor).expect(200);
      expect(current.body).toMatchObject({
        model: 'claude-sonnet-5-5',
        effort: 'low',
        enabledTools: ['buscar_casos', 'crear_lead', 'agendar_reunion'],
        maxMessagesPerSession: 20,
        instructions: expect.stringMatching(/^Eres el asistente de miwebprofesional/),
      });

      const valid = {
        model: 'claude-opus-5-5',
        effort: 'medium',
        instructions: 'Instrucciones nuevas',
        enabledTools: ['agendar_reunion', 'buscar_casos'],
        maxMessagesPerSession: 30,
      };
      const saved = await http().put('/api/v1/admin/assistant/settings').set(editor).send(valid).expect(200);
      expect(saved.body.enabledTools).toEqual(['buscar_casos', 'agendar_reunion']);

      for (const patch of [
        { model: 'gpt-5' },
        { effort: 'max' },
        { enabledTools: ['borrar_todo'] },
        { maxMessagesPerSession: 0 },
        { maxMessagesPerSession: 101 },
        { instructions: '' },
        { temperature: 0.7 },
      ]) {
        await http().put('/api/v1/admin/assistant/settings').set(editor).send({ ...valid, ...patch }).expect(400);
      }
      await http().put('/api/v1/admin/assistant/settings').set(editor).send({ model: 'claude-opus-5-5' }).expect(400);
    });

    it('POST /admin/assistant/test answers as JSON with only buscar_casos and stores nothing', async () => {
      model.script(
        { toolUses: [{ id: 'tu_1', name: 'buscar_casos', input: { query: 'contadores' } }] },
        { text: ['Sí [caso:contaflow-ia#0].'] },
      );

      const res = await http()
        .post('/api/v1/admin/assistant/test')
        .set(editor)
        .send({ question: '¿Qué hicieron para contadores?', locale: 'es', caseSlug: 'contaflow-ia' })
        .expect(200);

      expect(res.body).toMatchObject({
        answer: 'Sí.',
        sources: [{ sourceKey: 'caso:contaflow-ia#0', title: 'ContaFlow IA', url: '/es/casos/contaflow-ia' }],
        usage: { requests: 2 },
        stopReason: 'end_turn',
        unanswered: false,
      });
      expect(model.requests[0].tools?.map((t: any) => t.name)).toEqual(['buscar_casos']);
      expect(await prisma.conversation.count()).toBe(0);
      await http().post('/api/v1/admin/assistant/test').set(editor).send({ question: '' , locale: 'es' }).expect(400);
    });

    it('FAQ CRUD validates and soft-deletes', async () => {
      await http().post('/api/v1/admin/faqs').set(editor).send({ translations: {} }).expect(400);
      const created = await http()
        .post('/api/v1/admin/faqs')
        .set(editor)
        .send({ translations: { ES: { question: '¿Dan soporte?' } } })
        .expect(201);
      expect(created.body).toMatchObject({
        translations: { ES: { question: '¿Dan soporte?', answer: '', status: 'DRAFT' }, EN: null },
      });
      const failed = await http()
        .post(`/api/v1/admin/faqs/${created.body.id}/publish`)
        .set(editor)
        .send({ locale: 'ES' })
        .expect(422);
      expect(failed.body.details).toEqual({ locale: 'ES', missing: ['answer'] });
      await http()
        .patch(`/api/v1/admin/faqs/${created.body.id}`)
        .set(editor)
        .send({ translations: { EN: { question: 'Do you offer support?', answer: 'Yes.' } } })
        .expect(200);
      await http().delete(`/api/v1/admin/faqs/${created.body.id}`).set(editor).expect(204);
      await http().get(`/api/v1/admin/faqs/${created.body.id}`).set(editor).expect(404);
    });

    it('GET /admin/stats/overview returns KPIs and a daily series', async () => {
      model.script({ text: ['Hola.'] });
      await chat({ message: '¿Tienen experiencia con contadores?' }).expect(200);

      const res = await http().get('/api/v1/admin/stats/overview?days=7').set(editor).expect(200);

      expect(res.body.range).toMatchObject({ days: 7, timeZone: 'America/Lima' });
      expect(res.body.totals).toEqual({ visits: 0, conversations: 1, newLeads: 0, unanswered: 0 });
      expect(res.body.series).toHaveLength(7);
      expect(res.body.series.at(-1)).toMatchObject({ conversations: 1 });
      expect(res.body.topQuestions).toEqual([{ question: '¿Tienen experiencia con contadores?', count: 1 }]);
      await http().get('/api/v1/admin/stats/overview?days=0').set(editor).expect(400);
    });
  });
});
