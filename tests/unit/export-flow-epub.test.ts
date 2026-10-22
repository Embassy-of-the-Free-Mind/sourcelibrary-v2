import { describe, it, expect } from 'vitest';
import { buildFlowEpub, footnotesFor, PAGES_PER_SECTION } from '@/lib/export-flow-epub';

/**
 * The continuous EPUB (#7118): one reading text in sections, not one chapter per page — on a Kindle every chapter
 * is a page break. Images are covered where they are decided: the scan licence gate (no images unless 'open', and
 * the edition then says so) — the fetch/recompress path is the export's shared, separately tested helper.
 */
const db = (galleryRows = 0) => ({
  collection: () => ({
    find: () => ({ toArray: async () => [] }),
    countDocuments: async () => galleryRows,
  }),
});
const pages = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `pg${i + 1}`, page_number: i + 1, translation: { data: i % 2 === 0 ? 'The stone was' : 'heated for days.' },
}));

describe('footnotesFor', () => {
  it('turns notes and marginalia into EPUB 3 pop-up footnotes at the end of the section, ids unique across the book', () => {
    const seq = { n: 4 };
    const out = footnotesFor('<p>the anvil<span class="note">[original: "sub incude"]</span> and <span class="margin">[CHRIST.]</span></p>', seq);
    expect(out).toContain('the anvil<a epub:type="noteref" href="#fn5" id="fnref5" class="noteref">1</a>');
    expect(out).toContain('<aside epub:type="footnote" id="fn5" class="footnote"><p><a href="#fnref5">1.</a> original: "sub incude"</p></aside>');
    expect(out).toContain('<em>In the margin:</em> CHRIST.');
    expect(out).not.toContain('class="note"');
    expect(seq.n).toBe(6);
  });
  it('leaves a section without notes untouched', () => {
    expect(footnotesFor('<p>Plain.</p>', { n: 0 })).toBe('<p>Plain.</p>');
  });
});

describe('buildFlowEpub', () => {
  it('cuts a book with no chapters into even sections, joining pages inside each', async () => {
    const flow = await buildFlowEpub(db() as never, { id: 'b' }, pages(PAGES_PER_SECTION * 2 + 3), { text: 'translation', baseUrl: 'https://x', includeImages: false });
    expect(flow.chapters.map(c => c.title)).toEqual([`Pages 1–${PAGES_PER_SECTION}`, `Pages ${PAGES_PER_SECTION + 1}–${PAGES_PER_SECTION * 2}`, `Pages ${PAGES_PER_SECTION * 2 + 1}–${PAGES_PER_SECTION * 2 + 3}`]);
    expect(flow.chapters[0].content).toContain('The stone was <a class="page-marker" id="p2" href="https://x/book/b?page=2"');
  });

  it('uses the book\'s own chapters when it has them, and skips low-confidence ones', async () => {
    const book = { id: 'b', chapters: [{ title: 'Liber I', pageNumber: 1 }, { title: 'Guess', pageNumber: 2, confidence: 'low' }, { titleEn: 'Book II', title: 'Liber II', pageNumber: 3 }] };
    const flow = await buildFlowEpub(db() as never, book, pages(4), { text: 'translation', baseUrl: 'https://x', includeImages: false });
    expect(flow.chapters.map(c => c.title)).toEqual(['Liber I', 'Book II']);
    expect(flow.chapters[1].content.startsWith('<h2>Book II</h2>')).toBe(true);
  });

  it('says inside the edition when the scans may not be redistributed, so the illustrations are left out', async () => {
    const flow = await buildFlowEpub(db(12) as never, { id: 'b' }, pages(2), { text: 'translation', baseUrl: 'https://x', includeImages: false });
    expect(flow.imagesIncluded).toBe(0);
    expect(flow.imagesNote).toMatch(/text only.*12 illustrations are not included.*https:\/\/x\/book\/b/);
  });

  it('says nothing about illustrations when the book has none', async () => {
    const flow = await buildFlowEpub(db(0) as never, { id: 'b' }, pages(2), { text: 'translation', baseUrl: 'https://x', includeImages: true });
    expect(flow.imagesNote).toBeNull();
  });
});
