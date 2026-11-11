import { describe, it, expect } from 'vitest';
import { CANON_WORKS } from '@/lib/canon-works';
import { authorUrl } from '@/lib/slugify';

// The /work/[id] "More by" link goes through the canon entry's authorId, not a
// slug of its English display name (#4355). Lucretius is the case where the
// two differ: the thesaurus id is `titus-lucretius`, and `/author/lucretius`
// only resolves while the variant slug survives on the match surface.
describe('CANON_WORKS authorId', () => {
  it('every canon work names its author by id', () => {
    for (const w of CANON_WORKS) expect(w.authorId, w.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('the More-by link uses the id, not the display name', () => {
    const drn = CANON_WORKS.find(w => w.slug === 'de-rerum-natura')!;
    expect(authorUrl(drn.author, drn.authorId)).toBe('/author/titus-lucretius');
  });
});
