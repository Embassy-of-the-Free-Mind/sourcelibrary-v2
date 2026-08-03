/**
 * Tables must survive the WHOLE-TEXT export surfaces.
 *
 * `stripEditorialWrappers()` flattens GFM tables ("| 1 | 23 |" → "1  23"), which
 * is correct for the snippet/quote/search surfaces it was written for. Three
 * surfaces that deliver a page's *entire* text for reuse inherited that
 * flattening by accident — the PDF exporter, the bulk content API
 * (/api/books/[id]/text) and the corpus snapshot. Flattening keeps every cell
 * VALUE but discards the COLUMN it belonged to, so a 16-column calendar table
 * arrives as unrecoverable runs of bare digits, silently.
 *
 * These are behaviour tests, not source greps: each one exercises the real
 * function and would fail if the `keepTables` plumbing were removed.
 */
import { describe, it, expect } from 'vitest';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { splitPdfBlocks, cleanTranslationForPdf } from '@/lib/pdf-export';
import { pipeTableToHtml } from '@/lib/markdown-table-html';

const TABLE = [
  '| Days of October | Days of Scorpio | Degrees |',
  '| :--- | :--- | :--- |',
  '| 1 | 23 | 4 |',
  '| 2 | 24 | 5 |',
].join('\n');

describe('stripEditorialWrappers keepTables', () => {
  it('flattens tables by DEFAULT (snippet/quote behaviour is unchanged)', () => {
    const out = stripEditorialWrappers(TABLE);
    expect(out).not.toContain('|');
    expect(out).toContain('1  23  4');
  });

  it('keeps table markup when keepTables is set', () => {
    const out = stripEditorialWrappers(TABLE, { keepTables: true });
    expect(out).toContain('| 1 | 23 | 4 |');
    // The separator row must survive too, or downstream parsers lose the header.
    expect(out).toMatch(/\|\s*:?-+:?\s*\|/);
  });

  it('still strips editorial wrappers when keepTables is set (#2232 guarantee)', () => {
    const withWrapper = `<meta>AI description of the previous page</meta>\n${TABLE}`;
    const out = stripEditorialWrappers(withWrapper, { keepTables: true });
    expect(out).not.toContain('AI description');
    expect(out).toContain('| 1 | 23 | 4 |');
  });

  it('does not let the dash/thematic-break rules eat a separator row', () => {
    const wide = '| a | b | c | d | e | f | g | h | i | j | k | l |\n'
      + '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n'
      + '| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |';
    const out = stripEditorialWrappers(wide, { keepTables: true });
    expect(out).toContain('| 1 | 2 | 3 |');
    expect(out.split('\n').filter(l => l.trim().startsWith('|')).length).toBe(3);
  });
});

describe('splitPdfBlocks', () => {
  it('separates prose from a table and marks the header row', () => {
    const blocks = splitPdfBlocks(`Some prose before.\n${TABLE}\nSome prose after.`);
    expect(blocks.map(b => b.kind)).toEqual(['text', 'table', 'text']);
    const table = blocks[1];
    if (table.kind !== 'table') throw new Error('expected a table block');
    expect(table.hasHeader).toBe(true);
    expect(table.rows).toHaveLength(3); // header + 2 body rows, separator dropped
    expect(table.rows[2]).toEqual(['2', '24', '5']);
  });

  it('drops an all-empty header row rather than rendering blank cells', () => {
    const blocks = splitPdfBlocks('| | |\n| :--- | :--- |\n| Pulci | 493 |');
    const table = blocks[0];
    if (table.kind !== 'table') throw new Error('expected a table block');
    expect(table.hasHeader).toBe(false);
    expect(table.rows).toEqual([['Pulci', '493']]);
  });

  it('treats text with no table as a single prose block', () => {
    const blocks = splitPdfBlocks('Just a paragraph.\nAnd another line.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('text');
  });
});

describe('cleanTranslationForPdf', () => {
  it('preserves the table so writePdfBody can lay it out', () => {
    const out = cleanTranslationForPdf(TABLE, 'test-book-id');
    const blocks = splitPdfBlocks(out);
    expect(blocks.some(b => b.kind === 'table')).toBe(true);
  });
});

describe('pipeTableToHtml (EPUB path)', () => {
  it('converts a pipe table to real table markup with a header', () => {
    const html = pipeTableToHtml(TABLE);
    expect(html).toContain('<thead>');
    expect(html).toContain('<th>Days of October</th>');
    expect(html).toContain('<td>23</td>');
    expect(html).not.toContain('|');
  });

  it('returns null for a non-table block so the caller falls through to <p>', () => {
    expect(pipeTableToHtml('Just a paragraph.')).toBeNull();
    // One stray non-table line means the block is left alone, not half-converted.
    expect(pipeTableToHtml(`${TABLE}\nTrailing prose line.`)).toBeNull();
  });

  it('renders a headerless table as a body-only table', () => {
    const html = pipeTableToHtml('| a | b |\n| c | d |');
    expect(html).not.toContain('<thead>');
    expect(html).toContain('<td>a</td>');
  });
});
