import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/mongodb', () => ({ getDb: async () => ({}) }));

import { withThesaurusEnrichment, type AuthorThesaurusDoc } from '@/lib/author-thesaurus';

// #7786: the author page reads description and life dates from the legacy `entities` row, which
// most thesaurus docs do not have. The thesaurus's Wikidata fields fill what that row lacks.
const DOC: AuthorThesaurusDoc = {
  _id: 'cornelius-drebbel',
  slug: 'cornelius-drebbel',
  canonical_name: 'Cornelius Drebbel',
  wikidata_id: 'Q365463',
  wikidata_description: 'Dutch inventor',
  wikidata_birth_year: 1572,
  wikidata_death_year: 1633,
};

describe('withThesaurusEnrichment', () => {
  it('builds the enrichment from the thesaurus doc when there is no entity row', () => {
    const e = withThesaurusEnrichment(null, DOC)!;
    expect(e.description).toBe('Dutch inventor');
    expect(e.wikidata_birth_date).toBe('1572');
    expect(e.wikidata_death_date).toBe('1633');
    expect(e.wikidata_id).toBe('Q365463');
  });

  it('returns null when the thesaurus doc has nothing to add', () => {
    expect(withThesaurusEnrichment(null, { _id: 'x', slug: 'x', canonical_name: 'X' })).toBeNull();
  });

  it('never overrides what the entity row says, and fills only its gaps', () => {
    const e = withThesaurusEnrichment({ description: 'Inventor of the submarine', wikidata_birth_date: '' }, DOC)!;
    expect(e.description).toBe('Inventor of the submarine');
    expect(e.wikidata_birth_date).toBe('1572');
  });

  it('takes a life range whole from one source', () => {
    const e = withThesaurusEnrichment({ wikidata_death_date: '1633-11-07' }, DOC)!;
    expect(e.wikidata_birth_date).toBeUndefined();
    expect(e.wikidata_death_date).toBe('1633-11-07');
  });

  it('leaves out a BCE year, which the page cannot render', () => {
    const e = withThesaurusEnrichment(null, { ...DOC, wikidata_birth_year: -106, wikidata_death_year: -43 })!;
    expect(e.wikidata_birth_date).toBeUndefined();
    expect(e.wikidata_death_date).toBeUndefined();
  });
});
