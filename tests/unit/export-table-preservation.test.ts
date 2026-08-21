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
import { splitPdfBlocks, cleanTranslationForPdf, splitScriptRuns, writePdfBody, parseStyledLines, stripAnnotationTags } from '@/lib/pdf-export';
import { loadPdfFonts } from '@/lib/pdf-fonts';
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

  /**
   * Regression: OCR'd tables are frequently RAGGED — a damaged or merged cell
   * drops a pipe, so row lengths differ within one table. pdfkit sizes columns
   * from the widest declared row and then throws "unsupported number:
   * undefined" on any cell beyond it, killing the entire download. Found by
   * rendering a real PDF (page 203 yields rows of 9, 10 and 11 cells); every
   * rectangular fixture in this file passed straight over it.
   */
  it('pads ragged rows so the block is rectangular', () => {
    const ragged = '| a | b | c |\n| 1 | 2 |\n| x | y | z | w |';
    const blocks = splitPdfBlocks(ragged);
    const table = blocks[0];
    if (table.kind !== 'table') throw new Error('expected a table block');
    expect(new Set(table.rows.map(r => r.length))).toEqual(new Set([4]));
    expect(table.rows[1]).toEqual(['1', '2', '', '']);
    expect(table.rows[2]).toEqual(['x', 'y', 'z', 'w']);
  });
});

describe('cleanTranslationForPdf', () => {
  it('preserves the table so writePdfBody can lay it out', () => {
    const out = cleanTranslationForPdf(TABLE, 'test-book-id');
    const blocks = splitPdfBlocks(out);
    expect(blocks.some(b => b.kind === 'table')).toBe(true);
  });
});

/**
 * Noto Serif has no Arabic glyphs, so Arabic inside translation glosses
 * rendered as .notdef boxes in every PDF (97 of 366 pages on Kitab al-Bulhan —
 * confirmed by rasterising a real export). Noto Naskh Arabic has no Latin
 * glyphs, so swapping the document font just inverts the problem; only per-run
 * switching works.
 */
describe('mixed-script runs', () => {
  it('bundles an Arabic face', () => {
    expect(loadPdfFonts().arabic).toBeTruthy();
  });

  it('returns a single Latin run when there is no Arabic', () => {
    expect(splitScriptRuns('plain english text')).toEqual([
      { arabic: false, text: 'plain english text' },
    ]);
  });

  it('splits an inline Arabic gloss out of surrounding English', () => {
    const runs = splitScriptRuns('[original: "دري اللون" (durrī) – pearl-colored]');
    expect(runs.filter(r => r.arabic).map(r => r.text.trim())).toEqual(['دري اللون']);
    // Order is preserved and nothing is dropped.
    expect(runs.map(r => r.text).join('')).toBe('[original: "دري اللون" (durrī) – pearl-colored]');
  });

  it('keeps the space inside a multi-word Arabic run', () => {
    const runs = splitScriptRuns('x بسم الله الرحمن الرحيم y');
    const ar = runs.find(r => r.arabic);
    expect(ar?.text).toContain('بسم الله الرحمن الرحيم');
  });

  it('leaves a romanised transliteration on the Latin face', () => {
    const runs = splitScriptRuns('durrī and al-Thurayyā');
    expect(runs.every(r => !r.arabic)).toBe(true);
  });

  /**
   * Regression: `continued: true` resumes at the current x, and an embedded
   * "\n" inside a continued run does NOT reset it — so chaining runs across
   * multi-line text indents every line after the first to wherever the previous
   * run ended. Found by rendering the whole book and looking at page 195
   * ("hoping? for God's mercy" began mid-measure); no fixture caught it because
   * the earlier ones were all single-line.
   *
   * Asserts the invariant directly: a continued run never carries a newline.
   */
  it('never emits a continued run containing a newline', () => {
    const calls: Array<{ text: string; continued: boolean }> = [];
    const fakeDoc = {
      font() { return this; },
      fontSize() { return this; },
      fillColor() { return this; },
      text(t: string, o?: { continued?: boolean }) {
        calls.push({ text: t, continued: !!o?.continued });
        return this;
      },
    };
    const fonts = { regular: 'R', bold: 'B', italic: 'I', arabic: 'AR' };
    // Arabic on TWO different lines. That is what makes the intervening Latin
    // run — the one carrying the "\n" — a *continued* run. With Arabic on only
    // one line every newline falls in the final, non-continued run and the bug
    // is invisible; that fixture passed with the fix removed (negative control).
    const text = 'resident of Egypt "دري اللون" identity.\nhoping for mercy "قارعت الاثنين" amen\nthird line';
    writePdfBody(fakeDoc as never, fonts as never, text, { fontSize: 10 });

    expect(calls.length).toBeGreaterThan(1); // the mixed-script path ran
    for (const c of calls) {
      if (c.continued) expect(c.text).not.toContain('\n');
    }
    // Nothing is lost: every source line still appears.
    const joined = calls.map(c => c.text).join('');
    expect(joined).toContain('hoping for mercy');
    expect(joined).toContain('third line');
    expect(joined).toContain('دري اللون');
  });
});

describe('annotation color runs (PDF path)', () => {
  it('keeps annotation tags through cleaning so they can render as colored runs', () => {
    const out = cleanTranslationForPdf(
      'Body text <note>an editorial note</note> more <term>khawass</term> end.',
      'test-book-id'
    );
    expect(out).toContain('<note>');
    expect(out).toContain('<term>');
  });

  it('converts legacy bracket tags to XML annotation tags', () => {
    const out = cleanTranslationForPdf('Text [[gloss: a gloss]] tail.', 'test-book-id');
    expect(out).toContain('<gloss>a gloss</gloss>');
  });

  it('parseStyledLines splits body and annotation runs, appending ? to unclear', () => {
    const lines = parseStyledLines('before <unclear>reading</unclear> after');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      { style: null, text: 'before ' },
      { style: 'unclear', text: 'reading?' },
      { style: null, text: ' after' },
    ]);
  });

  it('carries a span style across an embedded newline, one run per line', () => {
    const lines = parseStyledLines('<note>first line\nsecond line</note>');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([{ style: 'note', text: 'first line' }]);
    expect(lines[1]).toEqual([{ style: 'note', text: 'second line' }]);
  });

  it('accepts attributes on annotation open tags', () => {
    const lines = parseStyledLines('<image-desc size="large">an engraving</image-desc>');
    expect(lines[0][0]).toEqual({ style: 'image-desc', text: 'an engraving' });
  });

  it('stripAnnotationTags unwraps content for colorless contexts (table cells)', () => {
    expect(stripAnnotationTags('a <gloss>b</gloss> c <unclear>d</unclear>')).toBe('a b c d?');
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
