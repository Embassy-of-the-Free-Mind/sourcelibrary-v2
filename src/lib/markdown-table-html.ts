/**
 * GFM pipe-table → HTML, for the EPUB/HTML export path.
 *
 * `markdownToHtml()` in the two download routes converts headings, emphasis and
 * our custom annotation tags, but had no table handling at all: a stored table
 * survived as literal pipe rows inside a `<p>` ("| 1 | 23 | 2 | 4 |"). That is
 * ugly but lossless; the PDF path's failure was worse (values kept, columns
 * lost). This module gives the EPUB real `<table>` markup so both exports agree.
 *
 * Contract: the caller has ALREADY HTML-escaped the text (`&`, `<`, `>`), which
 * is why cell content is interpolated verbatim here. Do not call this on raw
 * user/OCR text — see `markdownToHtml()` for the ordering.
 */

/** A single pipe-delimited row: `| a | b |`. */
const TABLE_ROW_RE = /^[ \t]*\|(.+)\|[ \t]*$/;
/** GFM alignment/separator row — cells are only dashes with optional colons. */
const TABLE_SEPARATOR_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;

// A cell's leading "# " is a heading marker the translator typed into the cell; it is not the cell's text.
const splitRow = (line: string): string[] =>
  (line.match(TABLE_ROW_RE)?.[1] ?? '').split('|').map(c => c.trim().replace(/^#{1,6}\s+/, ''));

/**
 * Convert a block whose lines are all pipe rows into an HTML table.
 *
 * Returns `null` when the block is not a table, so the caller can fall through
 * to its normal paragraph handling — a block with even one non-table line is
 * left alone rather than half-converted.
 */
export function pipeTableToHtml(block: string): string | null {
  const lines = block.split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;
  if (!lines.every(l => TABLE_ROW_RE.test(l) || TABLE_SEPARATOR_RE.test(l))) return null;

  const sepIndex = lines.findIndex(l => TABLE_SEPARATOR_RE.test(l));
  const rows = lines.filter(l => !TABLE_SEPARATOR_RE.test(l)).map(splitRow);
  if (!rows.length) return null;

  // A separator on line 2 marks line 1 as the header row. An all-empty header
  // ("| | |", common in OCR'd tables) is dropped rather than rendered as a band
  // of blank cells.
  let hasHeader = sepIndex === 1;
  if (hasHeader && rows[0].every(c => !c)) {
    rows.shift();
    hasHeader = false;
  }
  if (!rows.length) return null;

  const cell = (c: string, tag: 'th' | 'td') => `<${tag}>${c}</${tag}>`;
  const parts: string[] = ['<table class="page-table">'];
  if (hasHeader) {
    parts.push(`<thead><tr>${rows[0].map(c => cell(c, 'th')).join('')}</tr></thead>`);
  }
  const bodyRows = hasHeader ? rows.slice(1) : rows;
  parts.push('<tbody>');
  for (const r of bodyRows) parts.push(`<tr>${r.map(c => cell(c, 'td')).join('')}</tr>`);
  parts.push('</tbody></table>');
  return parts.join('');
}

/**
 * A block whose tables share it with ordinary lines — a caption above, a note below, a second table (no blank line
 * between, so it is one block): every contiguous run of pipe rows that holds a separator row becomes a table, and
 * the lines around them stay text, in order. Returns null when the block holds no such run.
 */
export function splitTableBlock(block: string): Array<{ text: string } | { table: string }> | null {
  const lines = block.split('\n');
  const isRow = (l: string) => TABLE_ROW_RE.test(l) || TABLE_SEPARATOR_RE.test(l);
  const parts: Array<{ text: string } | { table: string }> = [];
  let text: string[] = [];
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    let j = i;
    while (isRow(lines[i]) && j + 1 < lines.length && isRow(lines[j + 1])) j++;
    const run = lines.slice(i, j + 1);
    const table = isRow(lines[i]) && j > i && run.some(l => TABLE_SEPARATOR_RE.test(l)) ? pipeTableToHtml(run.join('\n')) : null;
    if (table) {
      if (text.length) parts.push({ text: text.join('\n') });
      parts.push({ table });
      text = [];
      found = true;
    } else {
      text.push(...run);
    }
    i = j;
  }
  if (!found) return null;
  if (text.length) parts.push({ text: text.join('\n') });
  return parts;
}
