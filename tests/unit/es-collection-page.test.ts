import { describe, it, expect } from 'vitest';
import { hasEsCollectionPage } from '@/lib/es-collections';

describe('hasEsCollectionPage', () => {
  it('is false for visual-art collections, which have no Spanish page', () => {
    expect(hasEsCollectionPage({ visible: true, collection_type: 'visual_art' })).toBe(false);
  });

  it('is false unless visible is exactly true', () => {
    expect(hasEsCollectionPage({})).toBe(false);
    expect(hasEsCollectionPage({ visible: false })).toBe(false);
  });

  it('is true for a visible text collection', () => {
    expect(hasEsCollectionPage({ visible: true, collection_type: 'thematic' })).toBe(true);
  });
});
