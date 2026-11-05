import { describe, it, expect } from 'vitest';
// @ts-expect-error untyped .mjs
import { words, shingles, MIN_SHINGLES } from '../../scripts/audit/match-passage.mjs';

describe('match-passage normalisation (#8150 slice 9)', () => {
  it('reads a marked, tagged passage as the same words as its clean copy', () => {
    const clean = 'Moved by love for my neighbour, I have wished to bring this little handbook into the light.';
    const marked = '<page-num>Page 1</page-num>\n' + clean.replace(' love', '​‌‍⁠ love').normalize('NFKC');
    expect(words(marked).filter((w: string) => w !== 'page' && w !== '1')).toEqual(words(clean));
  });
  it('builds 5-word shingles and refuses passages too short to prove anything', () => {
    const ws = words('one two three four five six');
    expect([...shingles(ws)]).toEqual(['one two three four five', 'two three four five six']);
    expect(shingles(words('a short line of eleven words that proves nothing at all'), 5).size).toBeLessThan(MIN_SHINGLES);
  });
});
