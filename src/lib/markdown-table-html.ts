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

const splitRow = (line: string): string[] =>
  (line.match(TABLE_ROW_RE)?.[1] ?? '').split('|').map(c => c.trim());

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
