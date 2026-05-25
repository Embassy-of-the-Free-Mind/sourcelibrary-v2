import { describe, it, expect } from 'vitest';
import { normalizeMarcAuthor, normalizeMarcPlace } from '@/lib/marc-utils';

describe('normalizeMarcAuthor', () => {
  it('returns null for the canonical "sine nomine" sigil', () => {
    expect(normalizeMarcAuthor('[s.n.]')).toBeNull();
  });

  it('normalizes common sigil variants to null', () => {
    for (const v of ['[S.N.]', 's.n.', 'S.N.', '[s.n]', '[S.n.]', '  [s.n.]  ']) {
      expect(normalizeMarcAuthor(v)).toBeNull();
    }
  });

  it('returns null for empty / whitespace / nullish input', () => {
    expect(normalizeMarcAuthor(null)).toBeNull();
    expect(normalizeMarcAuthor(undefined)).toBeNull();
    expect(normalizeMarcAuthor('')).toBeNull();
    expect(normalizeMarcAuthor('   ')).toBeNull();
  });

  it('preserves real author names verbatim (after trim)', () => {
    expect(normalizeMarcAuthor('Paracelsus')).toBe('Paracelsus');
    expect(normalizeMarcAuthor('  Knorr von Rosenroth, Christian  ')).toBe('Knorr von Rosenroth, Christian');
  });

  it('does not strip names that incidentally contain "s.n." substrings', () => {
    expect(normalizeMarcAuthor('Sn. Andersen')).toBe('Sn. Andersen');
  });
});

describe('normalizeMarcPlace', () => {
  it('returns null for the canonical "sine loco" sigil', () => {
    expect(normalizeMarcPlace('[s.l.]')).toBeNull();
  });

  it('preserves real place names', () => {
    expect(normalizeMarcPlace('Basileae')).toBe('Basileae');
  });
});
