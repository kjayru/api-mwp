import {
  countWords,
  readingMinutes,
  stripFencedCode,
  WORDS_PER_MINUTE,
} from './reading-time.js';

const words = (n: number) =>
  Array.from({ length: n }, () => 'palabra').join(' ');

describe('countWords', () => {
  it('counts plain words', () => {
    expect(countWords('Hola mundo, ¿qué tal?')).toBe(4);
    expect(countWords('')).toBe(0);
  });

  it('ignores markup characters', () => {
    const md = [
      '# Título del artículo',
      '',
      '> Una **cita** con _énfasis_',
      '',
      '- uno',
      '* dos',
      '1. tres',
      '',
      '---',
      '',
      '| Col A | Col B |',
      '|---|---|',
      '| a|b |',
    ].join('\n');
    // Título del artículo (3) + Una cita con énfasis (4) + uno dos 1. tres (4:
    // "1." has a digit) + Col A Col B (4) + a b (2)
    expect(countWords(md)).toBe(17);
  });

  it('keeps link and image texts but not their targets', () => {
    expect(
      countWords(
        'Lee [la guía oficial](https://nextjs.org/docs "Docs") y ![un diagrama](/img/a.png).',
      ),
    ).toBe(7);
    expect(countWords('Ver https://example.com/a-b-c ahora')).toBe(2);
    expect(countWords('[docs]: https://example.com\nTexto')).toBe(1);
  });

  it('ignores HTML tags and comments', () => {
    expect(countWords('<!-- nota interna --><kbd>Ctrl</kbd> + <br/> C')).toBe(
      2,
    );
  });

  it('counts inline code and compound words once', () => {
    expect(countWords('Usa `proxy.ts` con Next.js y multi-tenant')).toBe(6);
  });

  it('excludes fenced code blocks', () => {
    const md = [
      'Antes del código.',
      '```ts',
      'const a = 1; const b = 2; export default a + b;',
      '```',
      'Después.',
      '~~~~',
      'ignored ignored',
      '~~~',
      'still ignored: the fence needs 4 tildes',
      '~~~~',
      'Fin.',
    ].join('\n');
    expect(countWords(md)).toBe(5);
  });

  it('treats an unclosed fence as code until the end', () => {
    expect(countWords('Hola\n```\ncódigo sin cerrar\nmás')).toBe(1);
  });

  it('does not close a backtick fence with tildes', () => {
    expect(stripFencedCode('a\n```\nx\n~~~\ny\n```\nb')).toBe('a\nb');
  });
});

describe('readingMinutes', () => {
  it('is ceil(words / 200), at least 1', () => {
    expect(WORDS_PER_MINUTE).toBe(200);
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes(words(1))).toBe(1);
    expect(readingMinutes(words(200))).toBe(1);
    expect(readingMinutes(words(201))).toBe(2);
    expect(readingMinutes(words(1000))).toBe(5);
  });

  it('does not count code towards the reading time', () => {
    const code = '```\n' + words(1000) + '\n```';
    expect(readingMinutes(`${words(150)}\n${code}`)).toBe(1);
  });

  it('handles Windows line endings', () => {
    expect(countWords('uno\r\n```\r\ncode\r\n```\r\ndos')).toBe(2);
  });
});
