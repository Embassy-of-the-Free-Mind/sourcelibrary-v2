import { describe, it, expect } from 'vitest';
import { hasNonLatinScript } from '@/lib/non-latin-scripts';

describe('hasNonLatinScript', () => {
  it('matches plain labels', () => {
    for (const l of ['Greek', 'Hebrew', 'Arabic', 'Chinese', 'Russian']) {
      expect(hasNonLatinScript(l)).toBe(true);
    }
  });

  // The compound labels an exact-match set missed. Each is a real
  // `books.language` value in the production corpus.
  it('matches compound and qualified labels', () => {
    for (const l of [
      'Ancient Greek', 'Classical Chinese', 'Greek-Latin', 'Greek/Latin',
      'Hebrew and Judeo-Arabic', 'Hebrew and Aramaic', 'Hebrew-Greek',
      'Hebrew, Aramaic, and Judeo-Arabic', 'Classical Chinese / Japanese',
      'Ottoman Turkish', 'Church Slavonic', 'Pali', 'Hindi', 'Akkadian',
    ]) {
      expect(hasNonLatinScript(l), l).toBe(true);
    }
  });

  it('does not match Latin-script languages', () => {
    for (const l of ['Latin', 'Italian', 'Spanish', 'German', 'Dutch', 'French', 'English', 'Portuguese']) {
      expect(hasNonLatinScript(l), l).toBe(false);
    }
  });

  // ETCSL's Sumerian transcription is itself a romanisation.
  it('does not offer to romanise text that already is', () => {
    expect(hasNonLatinScript('Sumerian')).toBe(false);
  });

  it('handles absent input', () => {
    expect(hasNonLatinScript(undefined)).toBe(false);
    expect(hasNonLatinScript('')).toBe(false);
  });
});
