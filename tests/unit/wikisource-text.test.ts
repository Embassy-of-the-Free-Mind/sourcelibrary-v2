// Guard for the reference-cleaning bug found 2026-09-04 (#4523): a single-pass template
// strip leaves the OUTER template of a nested pair in the reference text, which is then
// scored against OCR output as if the page had printed it. 25 of 146 harvested references
// carried residue. Reference corruption is the worst failure mode in an eval stack —
// the resulting mismatch reads as an engine failure, so the error is charged to the
// wrong party and looks like a finding.
import { describe, it, expect } from 'vitest';
import { cleanPageText, pageQuality } from '../../scripts/eval/lib/wikisource-text.mjs';

describe('cleanPageText', () => {
  it('strips a simple template', () => {
    expect(cleanPageText('{{κέντρο| }}\n—Δαιμόνιον!')).toBe('—Δαιμόνιον!');
  });

  it('strips NESTED templates completely — the 2026-09-04 bug', () => {
    // The guard is that no MARKUP survives. The assertion used to be `toBe('κείμενο')`,
    // which also pinned the second bug (2026-09-05): the page prints ΤΙΤΛΟΣ, so deleting it
    // with its wrapper removed printed text from the reference.
    const out = cleanPageText('{{κέντρο|{{μεγάλο|ΤΙΤΛΟΣ}}}}\nκείμενο');
    expect(out).not.toMatch(/[{}]/);
    expect(out).toBe('ΤΙΤΛΟΣ\nκείμενο');
  });

  it('strips three levels of nesting', () => {
    const out = cleanPageText('{{a|{{b|{{c|xx}}}}}}\ntext');
    expect(out).not.toMatch(/[{}]/);
    expect(out).toContain('xx');
  });

  it('KEEPS the printed payload of a formatting template — the 2026-09-05 bug', () => {
    // {{SperrSchrift|…}} is letter-spaced type, not scaffolding. Blanking it took whole
    // printed lines out of the reference (measured: 6.2% of Greek letters, 1.7% of German).
    expect(cleanPageText("{{idt}}{{SperrSchrift|D’Glocke het zwölfi gschlage.}}"))
      .toBe('D’Glocke het zwölfi gschlage.');
    expect(cleanPageText('{{sc|Tabula Combinatoria}}')).toBe('Tabula Combinatoria');
  });

  it('drops scaffolding templates and their configuration', () => {
    expect(cleanPageText('{{SimpleLeader|ptxtindent=-4.00em}}body')).toBe('body');
    expect(cleanPageText('{{gap}}{{rule}}body')).toBe('body');
    expect(cleanPageText('{{Zitierempfehlung|Projekt=[[Hebel]]: x|Seite=167}}body')).toBe('body');
  });

  it('treats a footnote the same in both spellings — the phantom-correction bug', () => {
    // A validator moving a footnote from <ref> to {{CRef}} changed no printed text, but the
    // cleaner kept one form and dropped the other, so the edit read as a 13.6% correction and
    // inflated the measured reference error rate. Whichever way footnotes go, they go together.
    expect(cleanPageText('Gerstner<ref>Gilberts Annalen, Bd. V.</ref> body')).toBe('Gerstner body');
    expect(cleanPageText('Gerstner{{CRef|2=Gilberts Annalen, Bd. V.}} body')).toBe('Gerstner body');
  });

  it('picks the printed argument, not the CSS one', () => {
    expect(cleanPageText('{{larger|0.1em|ΜΕΘΩΝΗ}}')).toBe('ΜΕΘΩΝΗ');
  });

  it('keeps EVERY printed argument, not just the longest', () => {
    // A table-of-contents page is nothing but these. An earlier "longest argument wins" rule
    // cut one such 2,000-character reference down to a 23-character heading.
    expect(cleanPageText('{{SimpleLeader|17. Διήγησις Ἀπολλωνίου|Ἀπολλώνιος|mright=6.00em}}'))
      .toBe('17. Διήγησις Ἀπολλωνίου Ἀπολλώνιος');
  });

  it('emits a sort-key/display pair once', () => {
    // {{SimpleLeader|<unaccented anchor>|<accented printed form>}} is one printed line, not two.
    expect(cleanPageText('{{SimpleLeader|Αλεξιου Κομνηνου ποιημα|Ἀλεξίου Κομνηνοῦ ποίημα|mright=6em}}'))
      .toBe('Αλεξιου Κομνηνου ποιημα');
  });

  it('takes the fragment THIS page prints from a page-break hyphenation', () => {
    // {{hws|<on this page>|<whole word>}} — importing the whole word would put letters in
    // the reference that are printed on the NEXT page.
    expect(cleanPageText('con{{hws|greſ|congreſſum}}')).toBe('con greſ');
  });

  it('legacyTemplates reproduces the pre-fix behaviour, for measurement only', () => {
    expect(cleanPageText('{{sc|Tabula}} rasa', { legacyTemplates: true })).toBe('rasa');
  });

  it('leaves no stray braces from unbalanced markup', () => {
    expect(cleanPageText('{{center|TITLE\nbody')).not.toMatch(/[{}]/);
  });

  it('keeps the page text itself, including long-s', () => {
    // Fidelity detection depends on ſ surviving cleaning — if it were stripped, every
    // page would be misclassified as modernised and the glyph-diplomatic tier would vanish.
    expect(cleanPageText('Arcana Cœleſtia quae in Scriptura')).toContain('Cœleſtia');
  });

  it('resolves links to their label', () => {
    expect(cleanPageText('see [[Page:Foo.djvu/2|the next page]]')).toBe('see the next page');
    expect(cleanPageText('see [[Genesis]]')).toBe('see Genesis');
  });

  it('drops noinclude scaffolding (headers, pagequality)', () => {
    const raw = '<noinclude><pagequality level="4" user="x" /><div>hdr</div></noinclude>body text';
    expect(cleanPageText(raw)).toBe('body text');
  });

  it('survives empty and null input', () => {
    expect(cleanPageText('')).toBe('');
    expect(cleanPageText(null)).toBe('');
  });
});

describe('pageQuality', () => {
  it('reads the proofread level', () => {
    expect(pageQuality('<noinclude><pagequality level="4" user="a" /></noinclude>x')).toBe(4);
    expect(pageQuality('<pagequality level="3"/>')).toBe(3);
  });
  it('returns null when absent, so callers cannot mistake it for level 0', () => {
    expect(pageQuality('no marker here')).toBeNull();
  });
});
