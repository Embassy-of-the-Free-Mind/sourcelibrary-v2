import { describe, it, expect } from 'vitest';
import { stripProvenanceMarks } from '@/lib/provenance';

// The mark is a run of zero-width characters threaded through served text —
// U+200B/200C/200D and friends, terminated by U+FEFF.
const ZWSP = '​', ZWNJ = '‌', ZWJ = '‍', BOM = '﻿', LRM = '‎', WJ = '⁠';

describe('stripProvenanceMarks', () => {
  it('removes the whole zero-width family', () => {
    const marked = `All men${ZWSP}${ZWNJ} naturally${ZWJ} desire${WJ} to know.${BOM}`;
    expect(stripProvenanceMarks(marked)).toBe('All men naturally desire to know.');
  });

  it('leaves ordinary text untouched, including Greek and diacritics', () => {
    for (const s of ['πᾶσα τέχνη καὶ πᾶσα μέθοδος', 'Académie de l’espée', 'plain ascii']) {
      expect(stripProvenanceMarks(s)).toBe(s);
    }
  });

  // Real breakage the feedback described: the marks survive a paste into a
  // document, so a reader's own search for a phrase they can SEE fails.
  it('makes a marked phrase findable again', () => {
    const marked = `the guide of our${ZWSP}${ZWJ} movements`;
    expect(marked.includes('our movements')).toBe(false);
    expect(stripProvenanceMarks(marked).includes('our movements')).toBe(true);
  });

  it('does not eat a normal space or newline', () => {
    expect(stripProvenanceMarks('a b\nc')).toBe('a b\nc');
  });

  it('handles null, undefined and empty without throwing', () => {
    expect(stripProvenanceMarks(null)).toBe('');
    expect(stripProvenanceMarks(undefined)).toBe('');
    expect(stripProvenanceMarks('')).toBe('');
  });

  it('is idempotent', () => {
    const once = stripProvenanceMarks(`x${ZWSP}y${LRM}`);
    expect(stripProvenanceMarks(once)).toBe(once);
  });
});
