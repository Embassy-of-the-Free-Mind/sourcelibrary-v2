import { describe, it, expect } from 'vitest';
import { titleSpan, editDistance } from '@/lib/search-rescue';

describe('search rescue', () => {
  it('fills in the small words a reader left out of a title', () => {
    expect(titleSpan(['ship', 'fools'], 'The Ship of Fools and Other Grotesques')).toBe('ship of fools');
  });
  it('lines up misspelt words with the title', () => {
    expect(titleSpan(['shp', 'fols'], 'The Ship of Fools and Infernal Drollery')).toBe('ship of fools');
    expect(titleSpan(['atalanta', 'fugens'], 'Atalanta fugiens, hoc est, emblemata nova')).toBe('atalanta fugiens');
  });
  it('refuses words that are not close together, or out of order', () => {
    expect(titleSpan(['ship', 'grotesques'], 'The Ship of Fools and Other Grotesques')).toBeNull();
    expect(titleSpan(['fools', 'ship'], 'The Ship of Fools')).toBeNull();
  });
  it('counts a swap of neighbouring letters as one edit', () => {
    expect(editDistance('mermiad', 'mermaid')).toBe(1);
    expect(editDistance('alkemy', 'alchemy')).toBe(2);
    expect(editDistance('dragon', 'dragon')).toBe(0);
  });
});
