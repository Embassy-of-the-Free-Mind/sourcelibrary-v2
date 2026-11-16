// PRIOR ART: tests/unit/cite-ids.test.ts and tests/unit/citation-pages.test.ts pin the link MARKUP each
// pass writes; this pins that an answer carries ONE page-link form, and that an answer image is a
// display-sized gallery rendition rather than the page master (v3#250, findings 6 and 7).
// Fixtures are the URLs of two live turns on 2026-11-13: thread 6af70498c205a9be6ed8c6bb (the
// Ficino answer mixing /page-number/18 with ?page=15) and thread 6af704e3c205a9be6ed8c6c5 (the
// furnace answer that loaded a 2063x2632 scan into a 400 px box).
import { describe, it, expect } from 'vitest';
import { canonicalPageLinks, linkifySourceUrls } from '@/lib/markdown-prep';
import { findPageLinks, repointLink } from '@/lib/embassy/citation-pages';
import type { GroundingPage } from '@/lib/embassy/grounding';
import { toGalleryCardUrl, toGalleryFullUrl } from '@/lib/utils';

const BASE = 'https://sourcelibrary.org';

// The page links of the Ficino turn, in the order the answer gave them.
const FICINO_TURN = [
  `*[Three Books on Life](${BASE}/book/three-books-on-life-1489-first-edition-ficino)*, [Page 18](${BASE}/book/three-books-on-life-1489-first-edition-ficino/page-number/18)`,
  `*[De vita libri tres](${BASE}/book/de-vita-libri-tres-de-triplici-vita-apologia-quod-necessaria-ficinus-3)* by [Marsilio Ficino](${BASE}/author/marsilio-ficino), [Page 15](${BASE}/book/de-vita-libri-tres-de-triplici-vita-apologia-quod-necessaria-ficinus-3?page=15)`,
  `*[Three Books on Life](${BASE}/book/three-books-on-life-ficino)*, [Page 43](${BASE}/book/three-books-on-life-ficino?page=43)`,
  `[Page 11](${BASE}/book/de-vita-libri-tres-de-triplici-vita-apologia-quod-necessaria-ficinus-2?page=11)`,
].join('\n\n');

describe('canonicalPageLinks: one page-link form per answer', () => {
  it('turns the Ficino turn into /page-number/ links only, same books and pages', () => {
    const out = canonicalPageLinks(FICINO_TURN);
    expect(out).not.toContain('?page=');
    const pages = (s: string) => findPageLinks(s).map(l => `${l.slug}:${l.page}`);
    expect(pages(out)).toEqual(pages(FICINO_TURN));
    expect(pages(out)).toEqual([
      'three-books-on-life-1489-first-edition-ficino:18',
      'de-vita-libri-tres-de-triplici-vita-apologia-quod-necessaria-ficinus-3:15',
      'three-books-on-life-ficino:43',
      'de-vita-libri-tres-de-triplici-vita-apologia-quod-necessaria-ficinus-2:11',
    ]);
    // Book and author links are left alone.
    expect(out).toContain(`(${BASE}/book/three-books-on-life-ficino)*`);
    expect(out).toContain(`(${BASE}/author/marsilio-ficino)`);
  });

  it('keeps the /es prefix, which the ?page= redirect would have dropped', () => {
    expect(canonicalPageLinks(`[Página 3](${BASE}/es/book/picatrix?page=3)`))
      .toBe(`[Página 3](${BASE}/es/book/picatrix/page-number/3)`);
  });

  it('carries other query parameters across', () => {
    expect(canonicalPageLinks(`(${BASE}/book/x?page=5&highlight=saturn)`))
      .toBe(`(${BASE}/book/x/page-number/5?highlight=saturn)`);
  });

  it('leaves what is not a page link alone', () => {
    for (const s of [
      `${BASE}/book/x/page-number/5`,
      `${BASE}/book/x?pages=5`,
      `${BASE}/book/x?page=5a`,
      `${BASE}/api/books/x/quote?page=5`,
      `https://example.org/book/x?page=5`,
    ]) expect(canonicalPageLinks(s)).toBe(s);
  });

  it('a bare /page-number/ URL still gets its page label', () => {
    expect(linkifySourceUrls(`see ${BASE}/book/x/page-number/7 there`))
      .toBe(`see [View source (p. 7)](${BASE}/book/x/page-number/7) there`);
  });

  it('a repointed ?page= link comes out in the /page-number/ form', () => {
    const s = `[Page 15](${BASE}/es/book/x?page=15)`;
    const to: GroundingPage = { bookId: 'x', bookSlug: 'x', bookTitle: 'X', page: 16, text: '', parts: ['', '', ''] };
    expect(repointLink(s, findPageLinks(s)[0], to)).toBe(`[Page 16](${BASE}/es/book/x/page-number/16)`);
  });
});

describe('answer images: a display-sized gallery rendition, not the page master', () => {
  // gallery_images 69af0df8067c0c26ee26dfb8-0, measured 2026-11-13:
  //   image_url  archived/…/209.jpg  2063x2632, 867 KB  (what the answer loaded)
  //   thumbnail  …-0-thumb.jpg        300x313,   26 KB   (what search_images now hands the model)
  //   extracted  …-0.jpg              1414x1474, 554 KB  (what a click opens)
  const THUMB = 'https://images.sourcelibrary.org/gallery/69af0df8067c0c26ee26dee7/69af0df8067c0c26ee26dfb8-0-thumb.jpg?v=1780512738813';
  const MASTER = 'https://images.sourcelibrary.org/archived/69af0df8067c0c26ee26dee7/209.jpg';

  it('a gallery thumb upgrades to its 600 px card sibling and opens the full crop', () => {
    expect(toGalleryCardUrl(THUMB)).toBe('https://images.sourcelibrary.org/gallery/69af0df8067c0c26ee26dee7/69af0df8067c0c26ee26dfb8-0-card.jpg?v=1780512738813');
    expect(toGalleryFullUrl(THUMB)).toBe('https://images.sourcelibrary.org/gallery/69af0df8067c0c26ee26dee7/69af0df8067c0c26ee26dfb8-0.jpg?v=1780512738813');
  });

  it('a page master is not mistaken for a gallery crop (search_images keeps it only when a row has no crop)', () => {
    expect(toGalleryCardUrl(MASTER)).toBeNull();
    expect(toGalleryFullUrl(MASTER)).toBeNull();
  });
});
