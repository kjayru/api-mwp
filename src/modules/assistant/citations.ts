// Citation markers. The model cites a fragment by writing its source key in
// brackets right after the sentence: "... [caso:contaflow-ia#0]". The API
// removes the markers from the streamed text and reports the cited sources
// in the `sources` SSE event instead.

/** A complete marker, e.g. "[caso:contaflow-ia#0]" or "[faq:cm123#1]". */
const MARKER = /^\[((?:caso|faq):[^\]\s#]+#\d+)\]$/;
/** Text that may still become a marker as more characters arrive. */
const MARKER_PREFIX =
  /^\[(?:c(?:a(?:s(?:o(?::[^\]\s#]*(?:#\d*)?)?)?)?)?|f(?:a(?:q(?::[^\]\s#]*(?:#\d*)?)?)?)?)?$/;
const MAX_MARKER_LENGTH = 200;

/**
 * Streaming filter: push() text deltas, get back the text without markers.
 * Text that might be the start of a marker is held until it is decided; a
 * space (or tab) right before a marker is dropped with it.
 */
export class CitationStreamFilter {
  private held = '';
  private spaces = '';
  private readonly citedKeys: string[] = [];

  /** Source keys cited so far, in order of first citation, without repeats. */
  get cited(): string[] {
    return [...new Set(this.citedKeys)];
  }

  push(text: string): string {
    let out = '';
    for (const char of text) out += this.feed(char);
    return out;
  }

  /** Releases whatever is held (call once at the end of the stream). */
  end(): string {
    const rest = this.spaces + this.held;
    this.spaces = '';
    this.held = '';
    return rest;
  }

  private feed(char: string): string {
    if (this.held) {
      const candidate = this.held + char;
      const marker = MARKER.exec(candidate);
      if (marker) {
        this.citedKeys.push(marker[1]);
        this.held = '';
        this.spaces = '';
        return '';
      }
      if (MARKER_PREFIX.test(candidate) && candidate.length < MAX_MARKER_LENGTH) {
        this.held = candidate;
        return '';
      }
      // Not a marker after all: release it and look at `char` afresh.
      const released = this.spaces + this.held;
      this.held = '';
      this.spaces = '';
      return released + this.feed(char);
    }
    if (char === '[') {
      this.held = '[';
      return '';
    }
    if (char === ' ' || char === '\t') {
      this.spaces += char;
      return '';
    }
    const released = this.spaces + char;
    this.spaces = '';
    return released;
  }
}

/** Removes every marker from a complete text (same rules as the stream filter). */
export function stripCitations(text: string): { text: string; cited: string[] } {
  const filter = new CitationStreamFilter();
  const clean = filter.push(text) + filter.end();
  return { text: clean, cited: filter.cited };
}
