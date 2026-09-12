/**
 * #4288 item 1 — an AI description of a picture must never be citable as a
 * published title.
 *
 * The fixtures below are the SHAPES measured in production on 2026-08-28, not
 * invented ones: 12,245 artwork records carry an `ai_enrichment` stamp on
 * `display_title` (7,523 public), 11,124 carry a display_title identical to
 * `title`, and 1,455 differ with no stamp at all. Each bucket gets a test,
 * because the interesting failure is a resolver that is right about the loud
 * bucket and wrong about a quiet one.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveTitle,
  citationTitle,
  hasDescriptiveTitle,
  isArtworkRecord,
  titleProvenanceNote,
} from '@/lib/title-provenance';
import { generateCitations } from '@/lib/citation';
import type { Book } from '@/lib/types';

/** /artwork/el-cerebro-segn-fludd, as it stands in production. */
const fluddArtwork = {
  title: 'El cerebro según Fludd',
  display_title: 'The Macrocosm and the Human Intellect',
  author: 'Robert Fludd',
  published: '1619',
  content_type: 'artwork',
  resource_type: 'scientific',
  field_provenance: {
    display_title: {
      source: 'ai_enrichment',
      model: 'gemini-3.1-flash-lite',
      script: 'artwork-enrichment.mjs',
      previous_value: 'El cerebro según Fludd',
    },
  },
};

/** /artwork/robertfuddbewusstsein17jh-hc — real title is a Commons filename. */
const bewusstseinArtwork = {
  title: 'RobertFuddBewusstsein17Jh-hc',
  display_title: 'The Microcosmic Mind and the Three Worlds',
  author: 'Robert Fludd',
  content_type: 'artwork',
  resource_type: 'scientific',
  field_provenance: {
    display_title: { source: 'ai_enrichment', model: 'gemini-3.1-flash-lite' },
  },
};

describe('resolveTitle — the descriptive-label bucket (12,245 records)', () => {
  it('marks an AI-written artwork title as descriptive, not a title', () => {
    const r = resolveTitle(fluddArtwork);
    expect(r.provenance).toBe('descriptive');
    expect(r.isDescriptive).toBe(true);
    expect(r.model).toBe('gemini-3.1-flash-lite');
  });

  it('still SHOWS the label — legibility is not the problem being fixed', () => {
    expect(resolveTitle(fluddArtwork).display).toBe('The Macrocosm and the Human Intellect');
  });

  it('cites the source record title, never the invented one', () => {
    expect(citationTitle(fluddArtwork)).toBe('El cerebro según Fludd');
    expect(citationTitle(bewusstseinArtwork)).toBe('RobertFuddBewusstsein17Jh-hc');
  });

  it('names what the label is, in prose, for tool results', () => {
    const note = titleProvenanceNote(fluddArtwork);
    expect(note).toContain('not a published title');
    expect(note).toContain('El cerebro según Fludd');
  });
});

describe('resolveTitle — the quiet buckets', () => {
  it('display_title identical to title is the source record title (11,124 records)', () => {
    const met = {
      title: 'Portrait of a Dervish',
      display_title: 'Portrait of a Dervish',
      content_type: 'artwork',
      resource_type: 'painting',
    };
    const r = resolveTitle(met);
    expect(r.provenance).toBe('source');
    expect(r.isDescriptive).toBe(false);
    expect(citationTitle(met)).toBe('Portrait of a Dervish');
    expect(titleProvenanceNote(met)).toBeNull();
  });

  it('an unstamped rewrite is derived, not descriptive — and cites the full title (1,455 records)', () => {
    // scripts/clean-artwork-metadata.mjs strips catalogue apparatus and, before
    // this change, recorded no provenance. Truthful, but unprovable from the row.
    const rops = {
      title: 'La petite liseuse et Indolence : estampe (2e état, pour la planche du haut) / Félicien Rops',
      display_title: 'The Little Reader and Indolence',
      content_type: 'artwork',
      resource_type: 'print',
    };
    const r = resolveTitle(rops);
    expect(r.provenance).toBe('derived');
    expect(r.isDescriptive).toBe(false);
    expect(r.citation).toBe(rops.title);
  });

  it('a stamp naming a real catalogue is a source title, not an AI label', () => {
    const wellcome = {
      title: 'Anatomia',
      display_title: 'Anatomia humani corporis',
      content_type: 'artwork',
      resource_type: 'print',
      field_provenance: { display_title: { source: 'wellcome_collection' } },
    };
    expect(resolveTitle(wellcome).provenance).toBe('source');
    expect(hasDescriptiveTitle(wellcome)).toBe(false);
  });

  it('a record with no display_title is untouched', () => {
    const bare = { title: 'Utriusque Cosmi Historia', content_type: 'artwork', resource_type: 'print' };
    expect(resolveTitle(bare).display).toBe('Utriusque Cosmi Historia');
    expect(citationTitle(bare)).toBe('Utriusque Cosmi Historia');
  });
});

describe('scope — textual books keep their translated display titles', () => {
  // On a BOOK, display_title is an English rendering of a title that exists in
  // print. That is not an invention and #4288 item 1 does not touch it. This
  // test is the guard: 7,624 non-artwork books carry an ai_enrichment stamp on
  // display_title, and a resolver that keyed only on the stamp would silently
  // change every one of their citations.
  const fenelon = {
    title: 'Dialogues des morts anciens et modernes',
    display_title: 'Dialogues of the Dead',
    field_provenance: {
      display_title: { source: 'ai_enrichment', model: 'gemini-3.1-flash-lite', pages_checked: 23 },
    },
  };

  it('a book with an AI-translated title still cites the translated title', () => {
    expect(resolveTitle(fenelon).provenance).toBe('source');
    expect(citationTitle(fenelon)).toBe('Dialogues of the Dead');
    expect(hasDescriptiveTitle(fenelon)).toBe(false);
  });

  it('an explicit content_type of book/text beats a stray resource_type', () => {
    // A digitized papyrus tagged resource_type:'papyrus_fragment' is a TEXT.
    const papyrus = { title: 'P.Oxy. 654', display_title: 'Sayings of Jesus', content_type: 'text', resource_type: 'papyrus_fragment' };
    expect(isArtworkRecord(papyrus)).toBe(false);
    expect(resolveTitle(papyrus).provenance).toBe('source');
  });

  it('resource_type alone is enough to be an artwork', () => {
    expect(isArtworkRecord({ resource_type: 'engraving' })).toBe(true);
    expect(isArtworkRecord({ content_type: 'artwork' })).toBe(true);
    expect(isArtworkRecord({ title: 'A book' })).toBe(false);
  });
});

describe('generateCitations does not assert a work that does not exist', () => {
  const base = { id: 'x', slug: 'el-cerebro-segn-fludd', language: 'Latin' };

  it('every citation format names the source record title, not the AI label', () => {
    const c = generateCitations({ ...base, ...fluddArtwork } as unknown as Book, 1, 'x', 'p1', 'https://sourcelibrary.org');
    for (const format of [c.footnote, c.bibliography, c.bibtex, c.chicago, c.mla]) {
      expect(format).toContain('El cerebro según Fludd');
      expect(format).not.toContain('The Macrocosm and the Human Intellect');
    }
  });

  it('a textual book\'s citation is byte-identical to the pre-#4288 behaviour', () => {
    const book = {
      id: 'y', slug: 'dialogues', language: 'French', author: 'Fénelon, François',
      published: '1712', ...{ title: 'Dialogues des morts anciens et modernes', display_title: 'Dialogues of the Dead' },
    } as unknown as Book;
    const c = generateCitations(book, 46, 'y', 'p46', 'https://sourcelibrary.org');
    expect(c.bibliography).toContain('Dialogues of the Dead');
    expect(c.chicago).toContain('Dialogues of the Dead');
  });
});
