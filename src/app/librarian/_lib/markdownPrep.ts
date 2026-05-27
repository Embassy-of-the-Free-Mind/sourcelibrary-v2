/**
 * Post-process Gemini output: convert bare sourcelibrary URLs to markdown links.
 * Gemini often outputs `https://sourcelibrary.org/book/slug?page=5` as plain text
 * instead of wrapping it in `[text](url)`. This catches those and linkifies them.
 */
export function linkifySourceUrls(text: string): string {
  let result = text.replace(
    /(?<!\]\()https:\/\/sourcelibrary\.org\/book\/([a-z0-9-]+)(?:\?page=(\d+))?/g,
    (match, _slug, page) => {
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
