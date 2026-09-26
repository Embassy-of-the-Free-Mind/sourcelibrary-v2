import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  queryTerms, textMatchesQuery, evidenceScore, plateFields, artworkFields, termVariants,
} from '@/lib/search-grounding';

// The rule: a search result must contain the query's words in its OWN text.
// Each case below is a real leak (2026-09-26) or a script the corpus holds.
describe('textMatchesQuery', () => {
  const cases: [query: string, text: string, expected: boolean, why: string][] = [
    ['mushroom', 'A cluster of Mushrooms on a log', true, 'plural + case'],
    ['mushroom', 'Two anthropomorphic monkey warriors, Wresaba and Saraba', false, 'semantic-lane leak'],
    ['smartphone', 'A gilt-metal table clock with an armillary sphere', false, 'semantic-lane leak'],
    ['rose', 'and the dead arose, singing in prose', false, 'substring-lane leak (Blake)'],
    ['rose', 'a red rose beside two ROSES', true, 'whole word'],
    ['cat', 'the cathedral of Chartres', false, 'no prefix matching'],
    ['rose', 'a rosette ornament', false, 'no prefix matching'],
    ['fly', 'flies around a lamp', true, 'y/ies plural'],
    ['Dürer', 'an engraving after Durer', true, 'diacritics fold'],
    ['ſun', 'the sun rising over the sea', true, 'long s folds'],
    ['the green lion', 'a green lion devouring the sun', true, 'all content words'],
    ['the green lion', 'a green dragon', false, 'every content word required'],
    ['the', 'the moon', true, 'query of only function words is still literal'],
    ['薛己', '明代醫家薛己的著作', true, 'Han: contiguous substring'],
    ['薛己', '薛氏醫案', false, 'Han: characters must be contiguous'],
    ['ἄγγελος', 'ΑΓΓΕΛΟΣ with wings', true, 'Greek final sigma'],
    ['قمر', 'صورة قمر في السماء', true, 'Arabic whole word'],
    ['गणेश', 'मूर्ति गणेश की', true, 'Devanagari keeps its marks'],
    ['!!!', 'anything at all', false, 'unjudgeable query grounds nothing'],
  ];
  for (const [q, text, expected, why] of cases) {
    it(`${JSON.stringify(q)} vs ${JSON.stringify(text.slice(0, 30))}: ${why}`, () => {
      expect(textMatchesQuery(text, queryTerms(q))).toBe(expected);
    });
  }

  it('marks punctuation-only queries unjudgeable', () => {
    expect(queryTerms('?!').judgeable).toBe(false);
  });

  it('never treats a prefix as a variant', () => {
    expect(termVariants('rose')).not.toContain('rosette');
  });
});

describe('evidenceScore ("Best match")', () => {
  const q = queryTerms('mushroom');
  it('ranks a tagged image above a description mention above an inscription-only mention', () => {
    const tagged = evidenceScore(plateFields({ metadata: { subjects: ['mushroom'] }, description: 'A woodcut.' }), q);
    const described = evidenceScore(plateFields({ description: 'A still life. In the corner, a mushroom.' }), q);
    const inscribed = evidenceScore(artworkFields({ title: 'Dietary Advice for Measles', enrichment: { inscriptions_translation: 'Avoid: mushroom, eel' } }), q);
    expect(tagged).toBeGreaterThan(described);
    expect(described).toBeGreaterThan(inscribed);
    expect(inscribed).toBeGreaterThan(0);
  });
  it('is 0 for an ungrounded item', () => {
    expect(evidenceScore(artworkFields({ title: 'Jatayu and Kumbakarna', description: 'A mythological bird-man.' }), q)).toBe(0);
  });
  it('does not count the book title as the plate\'s own text', () => {
    expect(evidenceScore(plateFields({ book_title: 'The Mushroom Book', description: 'Portrait of the author.' }), q)).toBe(0);
  });
});

// ---- the route: junk from EVERY lane at once must not reach the response ----
const plate = (id: string, description: string, subjects: string[] = []) => ({
  id, page_id: id, detection_index: 0, book_id: `book-${id}`, page_number: 1,
  image_url: `https://images.sourcelibrary.org/${id}.jpg`, extracted_url: `https://images.sourcelibrary.org/${id}.jpg`,
  gallery_quality: 0.9, book_rank: 1, book_year: 1600, book_title: 'The Mushroom Book', description,
  metadata: { subjects }, book_visible: true,
});
const artwork = (id: string, title: string, description: string, inscriptions_translation = '') => ({
  id, slug: id, title, description, year: 1850, image_display: `https://images.sourcelibrary.org/${id}.jpg`,
  content_type: 'artwork', visible: true, enrichment: { inscriptions_translation },
});

const lanePlates = [
  plate('junk-plate', 'A Balinese wayang figure'),                  // Atlas/CLIP-style leak
  plate('described', 'A still life; in the corner, a mushroom.'),
  plate('tagged', 'A woodcut of a forest floor', ['mushroom']),
  plate('book-title-only', 'Portrait of the author'),               // only its BOOK mentions mushrooms
];
const titleLaneArtworks = [
  artwork('measles', 'Dietary Advice for Measles', 'Two figures in kimono', 'Avoid: mushroom, eel, radish'),
  artwork('blake', 'The Marriage of Heaven and Hell', 'the dead arose'), // substring-lane leak
];
const semanticLaneArtworks = [artwork('wresaba', 'Wresaba and Saraba', 'Balinese monkey warriors')];

function cursor(rows: any[]) {
  const c: any = { sort: () => c, skip: () => c, limit: () => c, project: () => c, toArray: async () => rows };
  return c;
}
const fakeDb = {
  collection: (name: string) => ({
    estimatedDocumentCount: async () => 1000,
    countDocuments: async () => 4,
    distinct: async () => [],
    findOne: async () => null,
    aggregate: (pipeline: any[]) => ({
      toArray: async () => (pipeline.some(s => s.$count) ? [{ total: 4 }] : name === 'gallery_images' && pipeline.some(s => s.$search) ? lanePlates : []),
    }),
    find: (q: any) => cursor(
      name === 'books'
        ? (q?.id?.$in ? semanticLaneArtworks : titleLaneArtworks)
        : name === 'gallery_images' ? [] : [],
    ),
  }),
};

vi.mock('@/lib/mongodb', () => ({ getReadDb: async () => fakeDb, getDb: async () => fakeDb }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: async () => ({ data: [], error: null }) } }));
vi.mock('@/lib/embeddings', () => ({ generateQueryEmbedding: async () => [], cosineSimilarity: () => 0 }));
vi.mock('@/lib/clip', () => ({ CLIP_URL: 'http://clip.invalid' }));
vi.mock('@/lib/semantic-search', () => ({
  semanticArtworkSearch: async () => semanticLaneArtworks.map(a => ({ book_id: a.id, similarity: 0.7 })),
  semanticBookSearch: async () => [],
}));

describe('/api/gallery search response', () => {
  it('returns only grounded items from every lane, best evidence first', async () => {
    const { GET } = await import('@/app/api/gallery/route');
    const res = await GET(new NextRequest('https://sourcelibrary.org/api/gallery?q=mushroom&limit=48'));
    const body = await res.json();
    const keys = body.items.map((i: any) => i.pageId);
    expect(keys).toEqual(['tagged', 'described', 'artwork-measles']);
  });

  it('returns nothing for an unjudgeable query', async () => {
    const { GET } = await import('@/app/api/gallery/route');
    const res = await GET(new NextRequest('https://sourcelibrary.org/api/gallery?q=%21%21&limit=48'));
    expect((await res.json()).items).toEqual([]);
  });
});
