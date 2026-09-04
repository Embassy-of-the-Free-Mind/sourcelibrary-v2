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
    const out = cleanPageText('{{κέντρο|{{μεγάλο|ΤΙΤΛΟΣ}}}}\nκείμενο');
    expect(out).not.toMatch(/[{}]/);
    expect(out).toBe('κείμενο');
  });

  it('strips three levels of nesting', () => {
    const out = cleanPageText('{{a|{{b|{{c|x}}}}}}\ntext');
    expect(out).not.toMatch(/[{}]/);
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
