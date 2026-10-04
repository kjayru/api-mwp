/** Average adult reading speed for technical prose (words per minute). */
export const WORDS_PER_MINUTE = 200;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Drops fenced code blocks (``` or ~~~, CommonMark rules: the closing fence uses
 * the same character, is at least as long and has nothing else on its line; an
 * unclosed fence runs to the end of the document).
 */
export function stripFencedCode(markdown: string): string {
  const kept: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (
        close &&
        close[1][0] === fence.char &&
        close[1].length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    const open = line.match(FENCE_OPEN);
    if (open) {
      fence = { char: open[1][0], length: open[1].length };
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Words a reader actually reads in a Markdown document: fenced code blocks, HTML
 * tags, link and image targets, bare URLs and markup characters (#, *, _, >, |,
 * list markers, rules...) are not counted. Link texts, image alt texts and
 * inline code are.
 */
export function countWords(markdown: string): number {
  const text = stripFencedCode(markdown)
    // HTML tags and comments.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    // [text](url "title") and ![alt](url): keep the text, drop the target.
    .replace(/\]\([^)]*\)/g, '] ')
    // Reference definitions: [id]: https://...
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, ' ')
    // Bare URLs and autolinks.
    .replace(/https?:\/\/\S+/g, ' ')
    // Table pipes may touch the cell text.
    .replace(/\|/g, ' ');
  // A word is any whitespace-separated token with a letter or a digit, so
  // markup alone ("#", "-", "**", "---", ">") is not counted, while "Next.js",
  // "don't" or "**bold**" count once.
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token))
    .length;
}

/** `ceil(words / 200)`, at least 1 minute. */
export function readingMinutes(markdown: string): number {
  return Math.max(1, Math.ceil(countWords(markdown) / WORDS_PER_MINUTE));
}
