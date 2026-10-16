import { describe, it, expect } from 'vitest';
import { missingLabels, toRoman } from '@/lib/scan-gaps';
import { getReaderStrings } from '@/lib/reader-strings';

describe('scan gaps (#6675)', () => {
  it('names the printed pages strictly between the two scans', () => {
    expect(missingLabels(40, 45, 'arabic')).toEqual({ first: '41', last: '44' });
    expect(missingLabels(321, 323, 'arabic')).toEqual({ first: '322', last: null });
    expect(missingLabels(40, 41, 'arabic')).toBeNull();
    expect(missingLabels(17, 20, 'roman')).toEqual({ first: 'xviii', last: 'xix' });
  });

  it('writes lower-case roman numerals', () => {
    expect([1, 4, 9, 14, 40, 90, 400, 1994].map(toRoman)).toEqual(['i', 'iv', 'ix', 'xiv', 'xl', 'xc', 'cd', 'mcmxciv']);
  });

  it("uses Derek's wording, singular for one page", () => {
    const t = getReaderStrings('en').info;
    expect(t.missingPages('41', '44')).toBe('Pages 41–44 are missing from this scan.');
    expect(t.missingPages('322', null)).toBe('Page 322 is missing from this scan.');
  });
});
