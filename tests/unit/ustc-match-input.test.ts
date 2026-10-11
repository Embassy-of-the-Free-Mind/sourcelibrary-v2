/**
 * #4326 — the USTC matcher must never match an artwork on the caption a vision
 * model wrote for it. 109 of 159 artwork `ustc_id`s were bound that way; the
 * fixture below is the record the issue quotes, shape as measured.
 */
import { describe, it, expect } from 'vitest';
import { ustcMatchInput, USTC_MATCH_PROJECTION } from '@/lib/ustc-matcher';

const fluddArtwork = {
  id: 'robertfuddbewusstsein17jh-hc',
  title: 'RobertFuddBewusstsein17Jh-hc',
  display_title: 'The Microcosmic Mind and the Three Worlds',
  author: 'Robert Fludd',
  year: 1619,
  content_type: 'artwork',
  field_provenance: { display_title: { source: 'ai_enrichment', model: 'gemini' } },
};

describe('ustcMatchInput (#4326)', () => {
  it('matches an artwork on its source title, not its AI caption', () => {
    const input = ustcMatchInput(fluddArtwork);
    expect(input.title).toBe('RobertFuddBewusstsein17Jh-hc');
    expect(input.author).toBe('Robert Fludd');
    expect(input.year).toBe(1619);
  });

  it('keeps matching a textual book on its displayed (translated) title', () => {
    const input = ustcMatchInput({
      id: 'b1',
      title: 'Dialogues des morts anciens et modernes',
      display_title: 'Dialogues of the Dead',
      published: 1683,
      original_language: 'French',
    });
    expect(input.title).toBe('Dialogues of the Dead');
    expect(input.year).toBe(1683);
    expect(input.language).toBe('French');
  });

  it('projects the fields the title resolver needs', () => {
    for (const f of ['content_type', 'resource_type', 'field_provenance']) {
      expect(USTC_MATCH_PROJECTION).toHaveProperty(f, 1);
    }
  });
});
