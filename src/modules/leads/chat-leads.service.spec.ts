import type { PrismaService } from '../../prisma/prisma.service.js';
import { ChatLeadsService } from './chat-leads.service.js';

describe('ChatLeadsService.upsert (idempotent per conversation)', () => {
  const tx = {
    lead: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    conversation: { update: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const service = new ChatLeadsService(prisma as unknown as PrismaService);
  const input = {
    name: 'Ana',
    email: 'Ana@Example.COM',
    interest: 'SaaS',
    summary: 'Quiere una plataforma',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tx.lead.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'lead-1', ...data }));
    tx.lead.update.mockImplementation(async ({ data }: { data: object }) => ({ id: 'lead-1', ...data }));
  });

  it('creates the first lead of a conversation (CHAT_IA, locale, conversationId) and sets hasLead', async () => {
    tx.lead.findFirst.mockResolvedValue(null);

    const { created, lead } = await service.upsert('conv-1', 'EN', input);

    expect(created).toBe(true);
    expect(tx.lead.create).toHaveBeenCalledWith({
      data: {
        name: 'Ana',
        email: 'ana@example.com',
        phone: undefined,
        interest: 'SaaS',
        message: 'Quiere una plataforma',
        source: 'CHAT_IA',
        locale: 'EN',
        conversationId: 'conv-1',
      },
    });
    expect(lead.email).toBe('ana@example.com');
    expect(tx.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { hasLead: true },
    });
  });

  it('updates the existing lead instead of creating a second one', async () => {
    tx.lead.findFirst.mockResolvedValue({ id: 'lead-1', phone: '999', interest: 'Web', message: 'Antes' });

    const { created } = await service.upsert('conv-1', 'ES', { ...input, phone: null });

    expect(created).toBe(false);
    expect(tx.lead.create).not.toHaveBeenCalled();
    expect(tx.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      // A missing phone keeps the stored one.
      data: expect.objectContaining({ phone: undefined, interest: 'SaaS', message: 'Quiere una plataforma' }),
    });
  });

  it('fillOnly keeps what is already stored (agendar_reunion after crear_lead)', async () => {
    tx.lead.findFirst.mockResolvedValue({ id: 'lead-1', phone: null, interest: 'Web', message: 'Resumen rico' });

    await service.upsert('conv-1', 'ES', { ...input, phone: '123' }, { fillOnly: true });

    expect(tx.lead.update.mock.calls[0][0].data).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      phone: '123',
      interest: undefined,
      message: undefined,
    });
  });
});
