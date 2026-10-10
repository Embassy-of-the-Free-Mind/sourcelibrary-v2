import { describe, expect, it } from 'vitest';
import { applySpanEdits, normalizeEdits } from '../../scripts/lib/span-edits.mjs';

// Volunteer corrections are span edits applied to the STORED text (#6418), so a
// correction made against wrapper-stripped text cannot delete the wrappers.
describe('span edits', () => {
  const stored = '<page-type>text</page-type>\nIn principio erat verbvm, et verbum erat apud Deum.';

  it('applies an exact, unique span and leaves everything else untouched', () => {
    const r = applySpanEdits(stored, [{ find: 'verbvm', replace: 'verbum' }]);
    expect(r).toEqual({ text: '<page-type>text</page-type>\nIn principio erat verbum, et verbum erat apud Deum.' });
  });

  it('refuses a span that occurs more than once', () => {
    const r = applySpanEdits(stored, [{ find: 'erat', replace: 'est' }]);
    expect('error' in r && r.error).toMatch(/occurs 2 times/);
  });

  it('refuses a span that is not in the stored text', () => {
    const r = applySpanEdits(stored, [{ find: 'in the beginning', replace: 'x' }]);
    expect('error' in r && r.error).toMatch(/not in the stored text/);
  });

  it('refuses overlapping edits, and is independent of edit order otherwise', () => {
    expect('error' in applySpanEdits(stored, [
      { find: 'principio erat', replace: 'a' },
      { find: 'erat verbvm', replace: 'b' },
    ])).toBe(true);
    const a = applySpanEdits(stored, [{ find: 'verbvm', replace: 'verbum' }, { find: 'Deum', replace: 'Deum' + '!' }]);
    const b = applySpanEdits(stored, [{ find: 'Deum', replace: 'Deum' + '!' }, { find: 'verbvm', replace: 'verbum' }]);
    expect(a).toEqual(b);
  });

  it('normalizes input and rejects empty or identical edits', () => {
    expect('error' in normalizeEdits([])).toBe(true);
    expect('error' in normalizeEdits([{ find: ' ', replace: 'x' }])).toBe(true);
    expect('error' in normalizeEdits([{ find: 'a', replace: 'a' }])).toBe(true);
    expect('error' in normalizeEdits([{ find: 'a' }])).toBe(true);
    expect(normalizeEdits([{ find: 'a', replace: '', reason: '  dittography ' }])).toEqual({
      edits: [{ find: 'a', replace: '', reason: 'dittography' }],
    });
  });
});
