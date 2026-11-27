import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  ASSISTANT_TOOLS,
  DEFAULT_ASSISTANT_EFFORT,
  DEFAULT_ASSISTANT_INSTRUCTIONS,
  DEFAULT_ASSISTANT_MODEL,
  DEFAULT_MAX_MESSAGES_PER_SESSION,
} from './assistant-settings.constants.js';
import {
  AssistantSettingsService,
  SETTINGS_ID,
  UpdateAssistantSettingsDto,
} from './assistant-settings.service.js';

const NOW = new Date('2026-11-27T10:00:00Z');
const row = (over: object = {}) => ({
  id: SETTINGS_ID,
  model: 'claude-opus-5-5',
  effort: 'high',
  instructions: 'Sé amable',
  enabledTools: ['agendar_reunion', 'buscar_casos'],
  maxMessagesPerSession: 10,
  updatedAt: NOW,
  ...over,
});

describe('AssistantSettingsService', () => {
  const prisma = { assistantSettings: { upsert: vi.fn() } };
  let service: AssistantSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AssistantSettingsService(prisma as unknown as PrismaService);
  });

  describe('get', () => {
    it('creates the default row on first read (upsert with defaults, no update)', async () => {
      prisma.assistantSettings.upsert.mockResolvedValue(row());

      await service.get();

      const args = prisma.assistantSettings.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ id: SETTINGS_ID });
      expect(args.update).toEqual({});
      expect(args.create).toEqual({
        id: SETTINGS_ID,
        model: DEFAULT_ASSISTANT_MODEL,
        effort: DEFAULT_ASSISTANT_EFFORT,
        instructions: DEFAULT_ASSISTANT_INSTRUCTIONS,
        enabledTools: [...ASSISTANT_TOOLS],
        maxMessagesPerSession: DEFAULT_MAX_MESSAGES_PER_SESSION,
      });
    });

    it('returns the stored values with tools in the canonical order', async () => {
      prisma.assistantSettings.upsert.mockResolvedValue(row());

      expect(await service.get()).toEqual({
        model: 'claude-opus-5-5',
        effort: 'high',
        instructions: 'Sé amable',
        enabledTools: ['buscar_casos', 'agendar_reunion'],
        maxMessagesPerSession: 10,
        updatedAt: NOW,
      });
    });

    it('falls back to the defaults for an unknown model or effort and drops unknown tools', async () => {
      prisma.assistantSettings.upsert.mockResolvedValue(
        row({
          model: 'gpt-x',
          effort: 'extreme',
          enabledTools: ['hack', 'crear_lead'],
        }),
      );

      const view = await service.get();

      expect(view.model).toBe(DEFAULT_ASSISTANT_MODEL);
      expect(view.effort).toBe(DEFAULT_ASSISTANT_EFFORT);
      expect(view.enabledTools).toEqual(['crear_lead']);
    });
  });

  describe('update', () => {
    it('stores the canonical tool order and returns the fresh view', async () => {
      prisma.assistantSettings.upsert
        .mockResolvedValueOnce(row())
        .mockResolvedValueOnce(row({ model: 'claude-haiku-4-5' }));

      const view = await service.update({
        model: 'claude-haiku-4-5',
        effort: 'low',
        instructions: 'Nuevo',
        enabledTools: ['agendar_reunion', 'buscar_casos'],
        maxMessagesPerSession: 5,
      });

      const first = prisma.assistantSettings.upsert.mock.calls[0][0];
      expect(first.update.enabledTools).toEqual([
        'buscar_casos',
        'agendar_reunion',
      ]);
      expect(first.create).toMatchObject({
        id: SETTINGS_ID,
        maxMessagesPerSession: 5,
      });
      expect(prisma.assistantSettings.upsert).toHaveBeenCalledTimes(2);
      expect(view.model).toBe('claude-haiku-4-5');
    });
  });

  describe('UpdateAssistantSettingsDto validation', () => {
    const valid = {
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      instructions: '  Hola  ',
      enabledTools: ['buscar_casos'],
      maxMessagesPerSession: 20,
    };
    const check = (over: object = {}) => {
      const dto = plainToInstance(UpdateAssistantSettingsDto, {
        ...valid,
        ...over,
      });
      return validate(dto).then((errors) => ({ dto, errors }));
    };

    it('accepts a valid body and trims the instructions', async () => {
      const { dto, errors } = await check();
      expect(errors).toHaveLength(0);
      expect(dto.instructions).toBe('Hola');
    });

    it.each([
      ['model', { model: 'nope' }],
      ['effort', { effort: 'max' }],
      ['instructions', { instructions: '   ' }],
      ['enabledTools', { enabledTools: ['buscar_casos', 'buscar_casos'] }],
      ['enabledTools', { enabledTools: ['otra'] }],
      ['maxMessagesPerSession', { maxMessagesPerSession: 0 }],
      ['maxMessagesPerSession', { maxMessagesPerSession: 101 }],
      ['maxMessagesPerSession', { maxMessagesPerSession: 2.5 }],
    ])('rejects an invalid %s', async (property, over) => {
      const { errors } = await check(over);
      expect(errors.map((e) => e.property)).toContain(property);
    });
  });
});
