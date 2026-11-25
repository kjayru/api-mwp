import { CitationStreamFilter, stripCitations } from './citations.js';

describe('citations', () => {
  it('removes markers (and the space before them) and collects the keys', () => {
    expect(
      stripCitations(
        'Hicimos una plataforma contable [caso:contaflow-ia#0]. También pagos [caso:8-reyes#1][faq:cmx1#0].',
      ),
    ).toEqual({
      text: 'Hicimos una plataforma contable. También pagos.',
      cited: ['caso:contaflow-ia#0', 'caso:8-reyes#1', 'faq:cmx1#0'],
    });
  });

  it('handles markers split across deltas', () => {
    const filter = new CitationStreamFilter();
    const out = ['Sí ', '[ca', 'so:corte', 'maestro#', '0]', ' y más.']
      .map((delta) => filter.push(delta))
      .join('');
    expect(out + filter.end()).toBe('Sí y más.');
    expect(filter.cited).toEqual(['caso:cortemaestro#0']);
  });

  it('leaves other brackets, links and incomplete markers untouched', () => {
    const text =
      'Mira [esto](https://x.com), [caso:sin-numero], [caso:x#] y [Nota]. Fin [caso:abc';
    expect(stripCitations(text)).toEqual({ text, cited: [] });
  });

  it('keeps newlines and repeated citations once', () => {
    const result = stripCitations('Uno [caso:a#0]\n- Dos [caso:a#0]');
    expect(result).toEqual({ text: 'Uno\n- Dos', cited: ['caso:a#0'] });
  });

  it('releases held spaces and text at the end', () => {
    const filter = new CitationStreamFilter();
    expect(filter.push('Hola ')).toBe('Hola');
    expect(filter.push('[caso')).toBe('');
    expect(filter.end()).toBe(' [caso');
  });
});
