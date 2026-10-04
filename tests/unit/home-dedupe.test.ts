import { describe, it, expect } from 'vitest';
import { dedupeHomeSections, bookIdFromImageUrl } from '@/lib/home-dedupe';

// The 2026-10-04 render: Fludd's History of the Two Worlds was the showcase
// lead, the featured band's hero AND the first favorites card.
const FLUDD = '6952dac677f38f6761bc683a';
const OTHER = '69593413b282844d7b277aaf';
const third = '69520c46ab34727b1f044141';
const img = (book: string, page = 'aaaaaaaaaaaaaaaaaaaaaaaa', v = 'thumb') => `https://images.sourcelibrary.org/gallery/${book}/${page}-0-${v}.jpg?v=1`;
const books = (...ids: string[]) => ids.map((id) => ({ id }));

function sections() {
  return {
    recentlyTranslated: books('r1', 'r2'),
    mostLiked: books(FLUDD, 'r2', 'm3', 'm4', 'm5', 'm6'),
    showcaseItems: [{ slug: 'music-of-the-spheres', imageCandidates: [img(FLUDD), img(OTHER)], leadImageCandidates: [img(FLUDD, 'a'.repeat(24), 'full'), img(OTHER)] }],
    featuredItems: [{ collection: { hero_image: img(FLUDD) }, heroCandidates: [img(FLUDD), img(OTHER), img(third)], books: books(FLUDD, 'f2', 'f3', 'f4', 'f5') }],
    galleryPlates: [{ src: img(FLUDD) }, ...Array.from({ length: 25 }, (_, i) => ({ src: img(`${i}`.padStart(24, 'b')) }))],
  };
}

describe('dedupeHomeSections', () => {
  it('reads the book id out of a gallery URL', () => {
    expect(bookIdFromImageUrl(img(FLUDD))).toBe(FLUDD);
    expect(bookIdFromImageUrl('https://example.org/cover.jpg')).toBeNull();
  });

  it('shows one Fludd, not three', () => {
    const out = dedupeHomeSections(sections());
    // favorites keeps it (ranked shelf claims first) but drops the book already under Recently translated
    expect(out.mostLiked.map((b) => b.id)).toEqual([FLUDD, 'm3', 'm4', 'm5', 'm6']);
    // showcase falls back to its next image
    expect(bookIdFromImageUrl(out.showcaseItems[0].leadImageCandidates[0])).toBe(OTHER);
    expect(out.showcaseItems[0].imageCandidates).toHaveLength(2); // reordered, not removed
    // featured band skips both FLUDD (favorites) and OTHER (showcase)
    expect(bookIdFromImageUrl(out.featuredItems[0].collection.hero_image)).toBe(third);
    expect(out.featuredItems[0].books.map((b) => b.id)).toEqual(['f2', 'f3', 'f4', 'f5']);
    expect(out.galleryPlates.some((p) => bookIdFromImageUrl(p.src) === FLUDD)).toBe(false);
  });

  it('never empties a section', () => {
    const s = sections();
    s.featuredItems[0].heroCandidates = [img(FLUDD)];
    s.featuredItems[0].books = books(FLUDD, 'f2');
    s.galleryPlates = [{ src: img(FLUDD) }];
    const out = dedupeHomeSections(s);
    expect(bookIdFromImageUrl(out.featuredItems[0].collection.hero_image)).toBe(FLUDD);
    expect(out.featuredItems[0].books).toHaveLength(2);
    expect(out.galleryPlates).toHaveLength(1);
  });

  it('keeps a hand-picked showcase cover', () => {
    const out = dedupeHomeSections(sections(), { pinnedShowcaseSlugs: new Set(['music-of-the-spheres']) });
    expect(bookIdFromImageUrl(out.showcaseItems[0].leadImageCandidates[0])).toBe(FLUDD);
  });
});
