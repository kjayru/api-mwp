import {
  type CaseSource,
  casePath,
  chunkCase,
  chunkFaq,
  estimateTokens,
  MAX_CHUNK_TOKENS,
  packSections,
  scrubClient,
  sha256,
  splitText,
} from './chunking.js';

function caseSource(overrides: Partial<CaseSource> = {}): CaseSource {
  return {
    caseId: 'case-1',
    type: 'SAAS',
    client: 'Estudio Contable Pérez',
    anonymizeClient: false,
    year: 2026,
    technologies: [
      { name: 'Next.js', slug: 'nextjs' },
      { name: 'PostgreSQL', slug: 'postgresql' },
    ],
    locale: 'ES',
    title: 'ContaFlow IA',
    slug: 'contaflow-ia',
    tagline: 'SaaS · IA · Estudios contables',
    summary: 'Plataforma para estudios contables.',
    industry: 'Contabilidad',
    blocks: [
      { type: 'text', title: 'El reto', body: 'Estudio Contable Pérez usaba hojas de cálculo.' },
      { type: 'gallery', imageIds: ['img-1'], caption: 'Capturas' },
      { type: 'metrics', items: [{ value: '35%', label: 'menos tiempo de cierre' }] },
      { type: 'text', title: '', body: '' },
    ],
    ...overrides,
  };
}

describe('chunkCase', () => {
  it('builds one self-contained chunk with header, summary, text and metrics', () => {
    const [chunk, ...rest] = chunkCase(caseSource());

    expect(rest).toHaveLength(0);
    expect(chunk.sourceKey).toBe('caso:contaflow-ia#0');
    expect(chunk.chunkIndex).toBe(0);
    expect(chunk.url).toBe('/es/casos/contaflow-ia');
    expect(chunk.title).toBe('ContaFlow IA');
    expect(chunk.caseType).toBe('SAAS');
    expect(chunk.technologies).toEqual(['next.js', 'nextjs', 'postgresql']);
    expect(chunk.content).toContain('Caso: ContaFlow IA');
    expect(chunk.content).toContain('Tipo: SaaS · Industria: Contabilidad · Año: 2026');
    expect(chunk.content).toContain('Cliente: Estudio Contable Pérez');
    expect(chunk.content).toContain('Tecnologías: Next.js, PostgreSQL');
    expect(chunk.content).toContain('Resumen: Plataforma para estudios contables.');
    expect(chunk.content).toContain('## El reto\nEstudio Contable Pérez usaba');
    expect(chunk.content).toContain('## Resultados\n- 35% menos tiempo de cierre');
    // Gallery captions and empty text blocks are not indexed.
    expect(chunk.content).not.toContain('Capturas');
    expect(chunk.contentHash).toBe(sha256(chunk.content));
    expect(chunk.tokenCount).toBe(estimateTokens(chunk.content));
  });

  it('never includes the client of an anonymised case, not even inside the text', () => {
    const chunks = chunkCase(caseSource({ anonymizeClient: true }));
    const text = chunks.map((c) => c.content).join('\n');

    expect(text).not.toMatch(/Pérez/i);
    expect(text).not.toContain('Cliente:');
    expect(text).toContain('## El reto\nel cliente usaba hojas de cálculo.');
  });

  it('uses English labels, paths and the scrub word for EN translations', () => {
    const [chunk] = chunkCase(
      caseSource({
        locale: 'EN',
        slug: 'contaflow-ai',
        anonymizeClient: true,
        blocks: [{ type: 'text', title: 'The challenge', body: 'ESTUDIO CONTABLE PÉREZ used spreadsheets.' }],
      }),
    );
    expect(chunk.url).toBe('/en/casos/contaflow-ai');
    expect(chunk.sourceKey).toBe('caso:contaflow-ai#0');
    expect(chunk.content).toContain('Case: ContaFlow IA');
    expect(chunk.content).toContain('Type: SaaS');
    expect(chunk.content).toContain('the client used spreadsheets.');
  });

  it('splits long cases into chunks of at most MAX_CHUNK_TOKENS, each with the header', () => {
    const paragraph = 'Frase de prueba con contenido. '.repeat(40); // ~1240 chars
    const chunks = chunkCase(
      caseSource({
        blocks: Array.from({ length: 6 }, (_, i) => ({
          type: 'text',
          title: `Sección ${i + 1}`,
          body: `${paragraph}\n\n${paragraph}`,
        })),
      }),
    );

    expect(chunks.length).toBeGreaterThan(3);
    chunks.forEach((chunk, index) => {
      expect(chunk.sourceKey).toBe(`caso:contaflow-ia#${index}`);
      expect(chunk.content.startsWith('Caso: ContaFlow IA')).toBe(true);
      expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(MAX_CHUNK_TOKENS);
    });
    // Greedy packing: every chunk but the last is reasonably full (> 300 tokens).
    for (const chunk of chunks.slice(0, -1)) {
      expect(estimateTokens(chunk.content)).toBeGreaterThan(300);
    }
  });
});

describe('chunkFaq', () => {
  it('uses the question as header and title, with no url', () => {
    const [chunk] = chunkFaq({
      faqId: 'faq-1',
      locale: 'EN',
      question: 'How long does a project take?',
      answer: 'It depends on the scope.',
    });
    expect(chunk.sourceKey).toBe('faq:faq-1#0');
    expect(chunk.title).toBe('How long does a project take?');
    expect(chunk.url).toBeNull();
    expect(chunk.caseType).toBeNull();
    expect(chunk.content).toBe(
      'Frequently asked question: How long does a project take?\n\nIt depends on the scope.',
    );
  });
});

describe('helpers', () => {
  it('scrubClient ignores very short names and escapes regex characters', () => {
    expect(scrubClient('AB hizo algo', 'AB', 'ES')).toBe('AB hizo algo');
    expect(scrubClient('Hola (S.A.C.) y adiós', '(S.A.C.)', 'ES')).toBe(
      'Hola el cliente y adiós',
    );
    expect(scrubClient('texto', null, 'ES')).toBe('texto');
  });

  it('splitText breaks at paragraphs, then sentences, then hard limits', () => {
    expect(splitText('corto', 100)).toEqual(['corto']);
    const parts = splitText(`${'a'.repeat(80)}\n\n${'b'.repeat(80)}`, 100);
    expect(parts).toEqual(['a'.repeat(80), 'b'.repeat(80)]);
    const hard = splitText('x'.repeat(250), 100);
    expect(hard.every((p) => p.length <= 100)).toBe(true);
    expect(hard.join('')).toBe('x'.repeat(250));
  });

  it('packSections returns the header alone when there are no sections', () => {
    expect(packSections('Caso: X', ['', '  '])).toEqual(['Caso: X']);
  });

  it('casePath encodes the slug', () => {
    expect(casePath('EN', '8-reyes')).toBe('/en/casos/8-reyes');
  });
});
