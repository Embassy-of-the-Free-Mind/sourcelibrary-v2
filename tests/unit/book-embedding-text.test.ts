/**
 * Book-embedding text composition guards.
 *
 * The bug this pins: the composer read `.name` on people/places/concepts while
 * the index extractor emits `.term` (buildConceptIndexFromBatches returns
 * `{ term, pages, page_precision }`). Every element mapped to `undefined`, so
 * 14,237 live `book_embeddings` rows contained the literal line
 * "People: , , , ,". Separately, topic terms were keyed on `entries` — a legacy
 * shape present on ~1k of 18k book_indexes docs — so 35k of 36k rows had no
 * topic line at all, and the extractor's `vocabulary`/`keywords` output went
 * entirely unused.
 *
 * Net: the book-level semantic lane in /api/search and /api/search/unified was
 * matching on title, author, summary and section headings only.
 *
 * The invariant is that every entity and term the extractor produced reaches
 * the embedded text, and that no line is ever emitted with empty slots. The
 * failure mode is silent — a wrong field name yields well-formed text that
 * simply says nothing — so these assert on content, not shape.
 */
import { describe, it, expect } from 'vitest';

import {
  composeBookEmbeddingText,
  BOOK_INDEX_EMBEDDING_PROJECTION,
} from '../../scripts/lib/book-embedding-text.mjs';

const book = {
  title: 'De Humana Physiognomonia',
  author: 'Giambattista della Porta',
  language: 'Latin',
  published: '1586',
};

/** The shape buildConceptIndexFromBatches actually emits. */
const indexData = {
  bookSummary: { detailed: 'A treatise on reading character from the face.' },
  sectionSummaries: [{ title: 'On the forehead', summary: '...' }],
  people: [
    { term: 'Aristotle', pages: [4, 9], page_precision: 'page' },
    { term: 'Polemon', pages: [], page_precision: 'section', page_range: { start: 20, end: 30 } },
  ],
  places: [{ term: 'Naples', pages: [1], page_precision: 'page' }],
  concepts: [{ term: 'temperament', pages: [3, 7, 11], page_precision: 'page' }],
  vocabulary: [{ term: 'physiognomonia', pages: [1, 2, 3, 4], page_precision: 'page' }],
  keywords: [{ term: 'lion', pages: [40, 41], page_precision: 'page' }],
};

describe('composeBookEmbeddingText — entity lines', () => {
  const text = composeBookEmbeddingText(book, indexData);

  it('reads `term`, not `name`', () => {
    expect(text).toContain('People: Aristotle, Polemon');
    expect(text).toContain('Places: Naples');
    expect(text).toContain('Concepts: temperament');
  });

  it('never emits a line of empty slots', () => {
    // The exact production symptom: "People: , , , ,".
    for (const line of text.split('\n')) {
      expect(line).not.toMatch(/^(Topics|People|Places|Concepts): *(,|$)/);
      expect(line).not.toMatch(/, *,/);
    }
  });

  it('omits a label entirely rather than emitting it empty', () => {
    const noEntities = composeBookEmbeddingText(book, {
      bookSummary: { brief: 'x' },
      people: [{ pages: [1] }], // present but term-less
    });
    expect(noEntities).not.toContain('People:');
  });

  it('includes section precision entities — a real mention with no verified page', () => {
    // `pages: []` means #3361 attribution found no text match. The entity is
    // still a genuine signal for retrieval even when its page is unknown.
    expect(text).toContain('Polemon');
  });
});

describe('composeBookEmbeddingText — topic terms', () => {
  it('draws topics from vocabulary and keywords, not only the rare `entries`', () => {
    const text = composeBookEmbeddingText(book, indexData);
    expect(text).toMatch(/^Topics: /m);
    expect(text).toContain('physiognomonia');
    expect(text).toContain('lion');
  });

  it('still honours the legacy `entries` shape', () => {
    const text = composeBookEmbeddingText(book, {
      entries: [{ term: 'chiromancy', pages: [1, 2] }],
    });
    expect(text).toContain('Topics: chiromancy');
  });

  it('dedupes a term that appears in more than one source', () => {
    const text = composeBookEmbeddingText(book, {
      keywords: [{ term: 'lion', pages: [1, 2, 3] }],
      vocabulary: [{ term: 'lion', pages: [1] }],
    });
    expect(text.match(/lion/g)).toHaveLength(1);
  });

  it('orders topics by page frequency, most-cited first', () => {
    const text = composeBookEmbeddingText(book, {
      keywords: [
        { term: 'rare', pages: [1] },
        { term: 'common', pages: [1, 2, 3, 4, 5] },
      ],
    });
    expect(text).toContain('Topics: common, rare');
  });

  it('caps topics at 50 so one huge book cannot crowd out its own summary', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ term: `t${i}`, pages: [i] }));
    const line = composeBookEmbeddingText(book, { vocabulary: many })
      .split('\n').find(l => l.startsWith('Topics: '))!;
    expect(line.slice('Topics: '.length).split(', ')).toHaveLength(50);
  });
});

describe('BOOK_INDEX_EMBEDDING_PROJECTION', () => {
  it('projects every field the composer reads', () => {
    // A projection that omits a source silently empties that line — the same
    // class of failure as the field-name bug, one layer down.
    const keys = Object.keys(BOOK_INDEX_EMBEDDING_PROJECTION);
    for (const field of ['bookSummary', 'sectionSummaries', 'vocabulary', 'keywords', 'people', 'places', 'concepts']) {
      expect(keys).toContain(field);
    }
    expect(keys.some(k => k.startsWith('entries'))).toBe(true);
  });

  it('excludes pageSummaries, which is huge and unused by the composer', () => {
    expect(BOOK_INDEX_EMBEDDING_PROJECTION).not.toHaveProperty('pageSummaries');
  });
});

describe('composeBookEmbeddingText — general', () => {
  it('falls back to book-level prose when there is no index', () => {
    const text = composeBookEmbeddingText(
      { ...book, description: 'A Latin treatise on the face.' },
      null,
    );
    expect(text).toContain('A Latin treatise on the face.');
    expect(text).toContain('De Humana Physiognomonia');
  });

  it('does not duplicate prose when an index summary exists', () => {
    const text = composeBookEmbeddingText(
      { ...book, description: 'SHOULD NOT APPEAR' },
      indexData,
    );
    expect(text).not.toContain('SHOULD NOT APPEAR');
  });

  it('caps output at 8000 chars', () => {
    const huge = { bookSummary: { detailed: 'x'.repeat(20000) } };
    expect(composeBookEmbeddingText(book, huge)).toHaveLength(8000);
  });
});
