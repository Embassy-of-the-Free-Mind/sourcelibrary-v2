import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script module
import { foldToken, diffReads, parseRulings, assemble, replacesLite, adjudicationPrompt } from '../../scripts/batch/claude-ocr-two-read.mjs';

// The p200 dispute from the #6780 reference test: one read had "ein achtel Rom", the other "drey achtele Rom".
const A = '<page-type>text</page-type>\n\nItem 10 ayren klopfs wol, thu darein ein achtel\nRom, ein frisch schmaltz, so gross wie ein ay.';
const B = '<page-type>text</page-type>\n\nItem 10 eyren klopfs wol, thu darein drey achtele\nRom, ein frisch schmaltz, so groß wie ein ay.';

describe('claude-ocr-two-read diff (#6780)', () => {
  it('folds spelling variants that do not change the recipe, never digits', () => {
    expect(foldToken('ayren')).toBe(foldToken('eyren'));
    expect(foldToken('groß')).toBe(foldToken('gross'));
    expect(foldToken('vnd')).toBe(foldToken('und'));
    expect(foldToken('Rörlin,')).toBe(foldToken('rorlin'));
    expect(foldToken('1/8')).not.toBe(foldToken('3/8'));
    expect(foldToken('10')).not.toBe(foldToken('1'));
  });

  it('finds the quantity dispute and only that', () => {
    const d = diffReads(A, B);
    expect(d.hunks).toHaveLength(1);
    const p = adjudicationPrompt(d);
    expect(p).toContain('reading A: «ein achtel»');
    expect(p).toContain('reading B: «drey achtele»');
    expect(p).toContain('===== Dn =====');
  });

  it('writes the ruling into read A, keeping the line breaks of the read it chose', () => {
    const d = diffReads(A, B);
    const { text, disputes } = assemble(d, ['drey achtele']);
    expect(disputes).toEqual([{ id: 'D1', a: 'ein achtel', b: 'drey achtele', ruling: 'drey achtele', chose: 'B' }]);
    expect(text).toContain('thu darein drey achtele\nRom,');
    expect(text).toContain('Item 10 ayren');   // undisputed spelling stays read A's
  });

  it('a ruling of (nothing) drops the span; an own reading is written as given', () => {
    const d = diffReads('a b c x d e f', 'a b c d e f');
    expect(assemble(d, parseRulings('===== D1 =====\n(nothing)\n', 1)).text).toBe('a b c d e f');
    const d2 = diffReads('a b c x d e f', 'a b c y d e f');
    expect(assemble(d2, ['z']).text).toBe('a b c z d e f');
  });

  it('a blank read against a transcribed one is one dispute over the whole body', () => {
    const d = diffReads('<page-type>blank</page-type>\n<warning>show-through from the other side only</warning>', '<page-type>text</page-type>\n\nNim ein hecht, seud ihn wie sonst');
    expect(d.hunks).toHaveLength(1);
  });

  it('never disputes the readers\' notes, and never joins a note to page text in one span', () => {
    expect(diffReads('<warning>quick hand.</warning>\n\nNim ein hecht', '<warning>formal book hand, some unclear.</warning>\n\nNim ein hecht').hunks).toHaveLength(0);
    // the pilot p200 shape: A's <meta> line sits where B has none, right before a disputed first line
    const d = diffReads('<page-type>text</page-type>\n<warning>quick hand.</warning>\n<meta>scan 0200.</meta>\n\ngeust ein wenig wein daran, lass wol bachen',
      '<page-type>text</page-type>\n<warning>formal hand.</warning>\n\nzeuch ain wenig weinbern daran, lass wol bachen');
    expect(d.hunks).toHaveLength(1);
    expect(adjudicationPrompt(d)).toContain('reading A: «geust ein wenig wein»');
    expect(assemble(d, ['geuss ein wenig wein']).text).toBe('<page-type>text</page-type>\n<warning>quick hand.</warning>\n<meta>scan 0200.</meta>\n\ngeuss ein wenig wein daran, lass wol bachen');
  });

  it('refuses rulings whose markers are not exactly D1..Dn', () => {
    expect(parseRulings('===== D1 =====\nx\n===== D2 =====\ny', 2)).toEqual(['x', 'y']);
    expect(parseRulings('===== D1 =====\nx', 2)).toBeNull();
    expect(parseRulings('chatter\n===== D1 =====\nx', 1)).toBeNull();
    expect(parseRulings('===== D2 =====\nx\n===== D1 =====\ny', 2)).toBeNull();
  });

  it('lifts the overlap guard only for a flash-lite read on a listed book', () => {
    const books = new Set(['b1']);
    expect(replacesLite({ book_id: 'b1', ocr: { source: 'ai', model: 'gemini-3.1-flash-lite' } }, books)).toBe(true);
    expect(replacesLite({ book_id: 'b1', ocr: { source: 'batch_api', model: 'gemini-3.1-flash-lite' } }, books)).toBe(true);
    expect(replacesLite({ book_id: 'b2', ocr: { source: 'ai', model: 'gemini-3.1-flash-lite' } }, books)).toBe(false);
    expect(replacesLite({ book_id: 'b1', ocr: { source: 'ai', model: 'gemini-3.8-flash' } }, books)).toBe(false);
    expect(replacesLite({ book_id: 'b1', ocr: { source: 'manual', model: 'gemini-3.1-flash-lite' } }, books)).toBe(false);
  });
});
