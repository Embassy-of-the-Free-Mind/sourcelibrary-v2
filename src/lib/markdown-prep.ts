/**
 * One form for a link to a printed page: `/book/<slug>/page-number/N` (v3#250).
 *
 * Answers carried two forms side by side, `/page-number/N` and `?page=N`. Both
 * land on the reader at `/book/<slug>/page/<id>`, but `?page=N` is the weaker
 * one: its redirect (src/proxy.ts → /api/redirect/book-page) matches only
 * `/book/…`, so `/es/book/<slug>?page=N` opens the book, not the page, and it
 * has no nearest-page fallback. `/page-number/N` keeps the locale prefix
 * (src/lib/page-number-redirect.ts) and is what grounding.ts and the citation
 * passes write. The server now writes only that form; this rewrites answers
 * stored before, so a reopened thread reads the same.
 */
export function canonicalPageLinks(text: string): string {
  return text.replace(
    /(https:\/\/sourcelibrary\.org(?:\/es)?\/book\/[a-z0-9-]+)\?page=(\d+)(&[^\s)\]"'<>]*)?(?![\w=])/g,
    (_m, book: string, page: string, rest?: string) =>
      `${book}/page-number/${page}${rest ? `?${rest.slice(1)}` : ''}`,
  );
}

/**
 * Post-process Gemini output: convert bare sourcelibrary URLs to markdown links.
 * Gemini often outputs `https://sourcelibrary.org/book/slug/page-number/5` as plain text
 * instead of wrapping it in `[text](url)`. This catches those and linkifies them.
 */
export function linkifySourceUrls(text: string): string {
  let result = text.replace(
    /(?<!\]\()https:\/\/sourcelibrary\.org\/book\/([a-z0-9-]+)(?:\?page=(\d+)|\/page-number\/(\d+))?/g,
    (match, _slug, qPage, pathPage) => {
      const page = qPage || pathPage;
      const label = page ? `View source (p. ${page})` : 'View in collection';
      return `[${label}](${match})`;
    },
  );
  result = result.replace(
    /(?<!\]\()https:\/\/sourcelibrary\.org\/author\/([^\s)]+)/g,
    (match, name) => {
      const label = decodeURIComponent(name);
      return `[${label}](${match})`;
    },
  );
  return result;
}

/**
 * Ensure proper markdown paragraph breaks for Gemini output.
 *
 * Gemini emits single \n between paragraphs; standard markdown needs \n\n.
 * We double single newlines, but skip lines inside structures that depend on
 * being on adjacent lines: fenced code blocks and GFM tables.
 */
export function ensureParagraphBreaks(text: string): string {
  // Step 1: protect fenced code blocks.
  const codeParts = text.split(/(```[\s\S]*?```)/);
  return codeParts
    .map((part, i) => (i % 2 === 1 ? part : processProse(part)))
    .join('');
}

function processProse(chunk: string): string {
  const lines = chunk.split('\n');
  if (lines.length === 0) return '';
  let result = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const cur = lines[i];
    // Keep lines adjacent (single \n) only when:
    //   - both sides are table rows — preserves contiguous GFM table
    //   - both sides are blockquote continuations — keeps them as one quote
    //   - one side is already blank — existing break suffices
    // Otherwise insert a blank line so prose paragraphs (and table-to-prose
    // / prose-to-table transitions) get proper block separation.
    const keepTight =
      (isTableLine(prev) && isTableLine(cur)) ||
      (isBlockquoteLine(prev) && isBlockquoteLine(cur)) ||
      prev === '' ||
      cur === '';
    result += keepTight ? '\n' : '\n\n';
    result += cur;
  }
  return result.replace(/\n{3,}/g, '\n\n');
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length >= 2;
}

function isBlockquoteLine(line: string): boolean {
  return line.trimStart().startsWith('>');
}
