import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { applyNotesOff, preprocessTerms, unwrapPageMarks, stripAiAnnotations } from '@/lib/notes-off';
import { markdownToHtml } from '@/lib/export-markdown-html';

/**
 * What "notes off" means, pinned once (#3870, following #3811).
 *
 * The distinction the whole rule turns on: page marks (<margin>, <gloss>,
 * <insert>, <unclear>) are TRANSCRIPTION and must survive with their content;
 * <note>/<image-desc> are the AI's own commentary and are the only thing that
 * disappears. Both download routes had it backwards for margins.
 */
describe('notes-off rule', () => {
  it('keeps the content of page marks, dropping only the chip', () => {
    const out = applyNotesOff('The <margin>The level</margin> of the wall');
    expect(out).toBe('The The level of the wall');
    expect(out).toContain('The level');
  });

  it('keeps a plate page that is nothing but marginal labels', () => {
    // A map whose text is all cartouche labels: deleting page-mark content
    // empties the page entirely.
    const map = '<margin>Mare Germanicum</margin>\n<insert>Oceanus</insert>\n<unclear>Frisia</unclear>';
    expect(applyNotesOff(map).replace(/\s+/g, ' ').trim())
      .toBe('Mare Germanicum Oceanus Frisia');
  });

  it('removes AI commentary and its content', () => {
    expect(applyNotesOff('Body text <note>original: "corpus."</note> continues'))
      .toBe('Body text  continues');
    expect(applyNotesOff('<image-desc>An engraving of a lion</image-desc>')).toBe('');
  });

  it('drops a whole glossary line, chip and all', () => {
    const text = 'Real sentence.\n<term>bite</term> <note>original: "morsus."</note>';
    expect(applyNotesOff(text)).toBe('Real sentence.');
  });

  it('keeps an inline term+note pair as sentence content (#3811)', () => {
    // The term IS the translation of the word here — deleting the pair deletes
    // words the reader needs.
    const text = 'a <term>scheme of roundness</term> <note>original: "schema rotundationis"</note> is produced';
    const out = applyNotesOff(text);
    expect(out).toContain('scheme of roundness');
    expect(out).not.toContain('schema rotundationis');
  });

  it('drops a <gloss> that merely re-renders a preceding <term>', () => {
    expect(preprocessTerms('<term>aqua</term> <gloss>water</gloss>')).toBe('aqua');
  });

  it('flattens a note nested inside a page mark rather than keeping its text', () => {
    expect(applyNotesOff('<margin>Chilon <note>a sage</note></margin>')).toBe('Chilon ');
  });

  it('handles page-mark tags carrying attributes', () => {
    expect(unwrapPageMarks('<margin side="left">note text</margin>')).toBe('note text');
  });

  it('collapses the blank-line pileup left by removed annotations', () => {
    expect(stripAiAnnotations('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('is a no-op on text with no editorial markup', () => {
    expect(applyNotesOff('Plain page text, unmarked.')).toBe('Plain page text, unmarked.');
  });
});

describe('EPUB/HTML export honours the same rule', () => {
  it('keeps marginal transcription in a stripNotes export (#3870)', () => {
    const html = markdownToHtml('The <margin>The level</margin> of the wall', { stripNotes: true });
    expect(html).toContain('The level');
  });

  it('leaves no dangling term chip when its note is gone (#3870)', () => {
    const html = markdownToHtml('Real sentence.\n<term>bite</term> <note>original: "morsus."</note>', { stripNotes: true });
    expect(html).not.toContain('bite');
    expect(html).toContain('Real sentence.');
  });

  it('still renders notes and margins as chips when notes are on', () => {
    const html = markdownToHtml('Body <note>a note</note> and <margin>a margin</margin>', { stripNotes: false });
    expect(html).toContain('<span class="note">[a note]</span>');
    expect(html).toContain('<span class="margin">[a margin]</span>');
  });

  it('escapes stray angle brackets in page text without eating its own markup', () => {
    const html = markdownToHtml('5 < 6 and <note>x</note>', { stripNotes: false });
    expect(html).toContain('5 &lt; 6');
    expect(html).toContain('<span class="note">');
  });
});

/**
 * Drift guard. The two download routes are twins that are NOT parity-tested and
 * HAVE diverged (388 diff lines as of #3870 — the tenant copy is missing the
 * split-page image resolver, the bounded-concurrency prefetch and the zip
 * streaming). Whole-file parity is therefore not assertable; what this pins is
 * that neither route re-implements the text markup locally, which is how the
 * notes-off bug survived in the export for months after the reader was fixed.
 */
describe('download routes share one markup implementation', () => {
  const routes = [
    'src/app/api/books/[id]/download/route.ts',
    'src/app/api/[tenant]/books/[id]/download/route.ts',
  ];

  for (const rel of routes) {
    const src = readFileSync(path.join(process.cwd(), rel), 'utf8');

    it(`${rel} imports markdownToHtml instead of defining it`, () => {
      expect(src).toContain("from '@/lib/export-markdown-html'");
      expect(src).not.toMatch(/function\s+markdownToHtml\s*\(/);
    });

    it(`${rel} does not delete page-mark content locally`, () => {
      // The exact shape of the #3870 bug: a regex removing <margin>/<gloss>
      // together with everything inside it.
      expect(src).not.toMatch(/<(?:margin|gloss)>\[\\s\\S\]\*\?<\\\/(?:margin|gloss)>\/gi,\s*''/);
    });
  }
});
