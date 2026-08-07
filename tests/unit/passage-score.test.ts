import { describe, it, expect } from 'vitest';
import { scorePages, tokenize, fold } from '@/lib/passage-score';

/**
 * The scorer runs on the REGEX FALLBACK path only. Where Atlas is available its
 * corpus-wide BM25 is better than anything computable from one book's candidate
 * pool, and measurement said so plainly: rescoring Atlas's results moved the
 * wanted page of Taylor's Metaphysics from #1 to #366. These tests pin the
 * fallback's behaviour, not a replacement for Atlas.
 */

const page = (item: string, text: string) => ({ item, text });

describe('tokenize / fold', () => {
  it('matches on word boundaries, not substrings', () => {
    // The bug this replaces: indexOf("a") hit inside every word on every page,
    // which is why two unrelated natural-language queries returned the same
    // page set.
    expect(tokenize('a the')).toEqual(['a', 'the']);
    const scored = scorePages('a', [page('p1', 'alpha beta gamma delta'), page('p2', 'a beta gamma delta')]);
    expect(scored.map((s) => s.item)).toEqual(['p2']);
  });

  it('folds diacritics so Greek accents do not defeat a match', () => {
    expect(fold('ἐγένετο')).toBe('εγενετο');
    expect(fold('Ærōs')).toBe('æros');
  });
});

describe('document frequency replaces a stopword list', () => {
  it('ignores a term that appears on every candidate page, in any language', () => {
    // "the" is on all three, so its IDF is 0 and it cannot decide the ranking.
    // p3 wins on "heap" alone. No stopword list is consulted — and the same
    // mechanism handles καί and que, which no English list would carry.
    const pages = [
      page('p1', 'the whole and the parts and the whole again the the the'),
      page('p2', 'the parts of the thing are the parts of the whole the'),
      page('p3', 'the whole is not a heap'),
    ];
    const scored = scorePages('the heap', pages);
    expect(scored[0].item).toBe('p3');
    expect(scored[0].matched_terms).toContain('heap');
  });

  it('ranks by coverage when every term is a function word', () => {
    // Degenerate query: nothing discriminates. Return something ordered rather
    // than an arbitrary permutation.
    const scored = scorePages('the of', [page('p1', 'the of the of'), page('p2', 'x y z the q r s t u v')]);
    expect(scored).toHaveLength(2);
    expect(scored[0].item).toBe('p1');
  });
});

describe('length normalisation', () => {
  it('prefers a short page with the term over a long page that merely repeats it', () => {
    // The reported failure: "A fifty-page introduction discussing the
    // Metaphysics uses 'whole', 'parts' and 'heap' dozens of times across
    // discursive prose. The actual passage uses each term once, in one sentence."
    const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do '.repeat(40);
    const scored = scorePages('heap', [
      page('long', `${filler} heap ${filler} heap ${filler} heap`),
      page('short', 'the whole is not a heap of parts'),
    ]);
    expect(scored[0].item).toBe('short');
  });
});

describe('proximity', () => {
  it('prefers terms in one clause over the same terms scattered', () => {
    // Reported on Aldine p.705, which held the target sentence verbatim and
    // ranked LAST of eight behind a page that merely repeated one of the words.
    const gap = ' filler word here '.repeat(60);
    const scored = scorePages('plausible impossibilities', [
      page('scattered', `plausible ${gap} impossibilities`),
      page('together', `prefer plausible impossibilities to implausible possibilities`),
    ]);
    expect(scored[0].item).toBe('together');
  });

  it('gives no bonus when only one distinct term is present', () => {
    const scored = scorePages('alpha beta', [page('p1', 'alpha alpha alpha')]);
    expect(scored[0].score).toBeGreaterThan(0);
    expect(scored[0].matched_terms).toEqual(['alpha']);
  });
});

describe('edges', () => {
  it('returns nothing for a query that matches nothing', () => {
    // The reporter's own control: nonsense must return 0, proving matching runs.
    expect(scorePages('zebra pancake velocipede', [page('p1', 'the whole and the parts')])).toEqual([]);
  });

  it('returns nothing for an empty query or an empty pool', () => {
    expect(scorePages('', [page('p1', 'text')])).toEqual([]);
    expect(scorePages('heap', [])).toEqual([]);
  });
});
