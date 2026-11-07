import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildFlowEpub, dropCarriedRunningHead, footnotesFor, rankHeadings, renderFlowEpub, PAGES_PER_SECTION } from '@/lib/export-flow-epub';

/**
 * The continuous EPUB (#7118): one reading text in sections, not one chapter per page — on a Kindle every chapter
 * is a page break. Images are covered where they are decided: the scan licence gate (no images unless 'open', and
 * the edition then says so) — the fetch/recompress path is the export's shared, separately tested helper.
 */
const db = (galleryRows = 0, rows: unknown[] = []) => ({
  collection: () => ({
    find: () => ({ toArray: async () => rows }),
    countDocuments: async () => galleryRows,
  }),
});
const pages = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `pg${i + 1}`, page_number: i + 1, translation: { data: i % 2 === 0 ? 'The stone was' : 'heated for days.' },
}));

describe('rankHeadings', () => {
  it('maps a page\'s heading levels onto h3, h4, … in order, so none skips a level under the section h2', () => {
    expect(rankHeadings('<h1>Book</h1><p>x</p><h3>Chapter</h3>')).toBe('<h3>Book</h3><p>x</p><h4>Chapter</h4>');
    expect(rankHeadings('<h4>Only</h4>')).toBe('<h3>Only</h3>');
  });
});

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
  it('moves a footnote number stranded on its own line or paragraph to the end of the text before it', () => {
    const line = footnotesFor('<p>the way to them?<br/><span class="margin">[a]</span><br/>For enemies</p>', { n: 0 });
    expect(line).toContain('the way to them? <a epub:type="noteref"');
    const para = footnotesFor('<p>the way to them?</p>\n<p><span class="margin">[a]</span> <span class="margin">[b]</span></p>\n<p>Next.</p>', { n: 0 });
    expect(para).toMatch(/the way to them\? <a epub:type="noteref"[^>]*>1<\/a> <a epub:type="noteref"[^>]*>2<\/a>\s*<\/p>\n<p>Next\.<\/p>/);
  });
  it('joins a footnote number with no text before it to the text after it (Olaus Magnus, after a heading)', () => {
    const afterHeading = footnotesFor('<h3>CHAPTER I.</h3>\n<p><span class="note">[woodcut]</span></p>\n<p>Biarmia, therefore</p>', { n: 0 });
    expect(afterHeading).toMatch(/<h3>CHAPTER I\.<\/h3>\n<p><a epub:type="noteref"[^>]*>1<\/a> Biarmia, therefore<\/p>/);
    const headOfPara = footnotesFor('<p><a class="page-marker" id="p101" href="x">11</a><span class="margin">[a]</span><br/>Finmarchia is</p>', { n: 0 });
    expect(headOfPara).toMatch(/<p><a class="page-marker"[^>]*>11<\/a><a epub:type="noteref"[^>]*>1<\/a> Finmarchia is<\/p>/);
    // A number before a heading has nowhere quiet to go: it stays.
    const beforeHeading = footnotesFor('<p><span class="note">[x]</span></p>\n<h3>Next</h3>', { n: 0 });
    expect(beforeHeading).toMatch(/<p><a epub:type="noteref"[^>]*>1<\/a><\/p>\n<h3>/);
  });
  it('leaves a section without notes untouched', () => {
    expect(footnotesFor('<p>Plain.</p>', { n: 0 })).toBe('<p>Plain.</p>');
  });
});

/** Captured from production 2026-11-07 (#8333), cut after the first sentence or two; not written to fit. */
const OLAUS_420 = {
  ocr: "<language>Latin</language>\n<page-type>text</page-type>\n<page-num>231</page-num>\n<header>LIBER DECIMVS</header>\n<meta>Image quality: Good, some bleed-through from reverse page.</meta>\n\nperforata, ad sagittas, ac cætera tela in hostes emittenda.",
  translation: "# BOOK TEN\n\nperforated for the purpose of firing arrows and other projectiles at the enemy, or, as it is asserted elsewhere, so that they might wound the enemy from the holes themselves while remaining safe.",
};
const OLAUS_213 = {
  ocr: "<language>Latin</language>\n<page-type>text</page-type>\n<page-num>123</page-num>\n<header>LIBER TERTIUS</header>\n\n### De eisdem Magis, & similibus.\n\n### CAP. XIX.\n\n<margin>Hadingus rex illusus.</margin>\nDEINDE Othinus maior, atq; senior inter magos,",
  translation: "<header>THIRD BOOK</header>\n\n### Concerning the same Magicians, and similar ones.\n\n### CHAP. XIX.\n\n<margin>King Hadingus deluded.</margin>\nAFTERWARDS, Othinus <note>Odin</note>, the greatest and most senior among the magicians,",
};
const HERODOTUS_321 = {
  ocr: "<language>Ancient Greek</language>\n<page-type>text</page-type>\n<page-num>296</page-num>\n<header>HERODOTUS</header>\n<meta>Digitized by Google watermark at bottom right</meta>\n\nἄνω πρὸς τὸν οὐρανὸν ἀπειλέουσι τῷ θεῷ, οὐδένα ἄλλον θεὸν νομίζοντες εἶναι εἰ μὴ τὸν σφέτερον.",
  translation: "<meta>This page continues the account of the Getae, a Thracian people who believe in immortality.</meta>\n\n<page-num>296</page-num>\n\n->**HERODOTUS**<-\n\n...upward toward the sky they shoot arrows and threaten the god, believing that there is no other god but their own.",
};

describe('dropCarriedRunningHead (#8333)', () => {
  it('drops the running head a translation set as its first heading when the transcription tags it as furniture', () => {
    const out = dropCarriedRunningHead(OLAUS_420.translation, OLAUS_420.ocr);
    expect(out).not.toContain('BOOK TEN');
    expect(out).toContain('perforated for the purpose of firing arrows');
  });
  it('drops a running head set as a centred bold line, past the page\'s editorial tags', () => {
    const out = dropCarriedRunningHead(HERODOTUS_321.translation, HERODOTUS_321.ocr);
    expect(out).not.toContain('HERODOTUS');
    expect(out).toContain('<meta>This page continues');
    expect(out).toContain('...upward toward the sky');
  });
  it('keeps a chapter title at the top of a page: the transcription has it as a heading too', () => {
    expect(dropCarriedRunningHead(OLAUS_213.translation, OLAUS_213.ocr)).toBe(OLAUS_213.translation);
  });
  it('changes nothing when the transcription tags no running head', () => {
    const ocr = OLAUS_420.ocr.replace('<header>LIBER DECIMVS</header>\n', '');
    expect(dropCarriedRunningHead(OLAUS_420.translation, ocr)).toBe(OLAUS_420.translation);
    expect(dropCarriedRunningHead(OLAUS_420.translation, undefined)).toBe(OLAUS_420.translation);
  });
  it('keeps the running head out of the exported flow text, not only out of the helper', async () => {
    const book = { id: 'b', chapters: [] };
    const flow = await buildFlowEpub(db() as never, book, [{ id: 'p1', page_number: 1, ...{ ocr: { data: OLAUS_420.ocr }, translation: { data: OLAUS_420.translation } } }], { text: 'translation', baseUrl: 'https://x', includeImages: false });
    const text = flow.chapters.map(c => c.content).join('').replace(/[\u200b-\u200f\u2060-\u2064\ufeff]/g, '');
    expect(text).not.toContain('BOOK TEN');
    expect(text).toContain('perforated for the purpose');
  });
  it('shows the printed page number on the marker where the book vouches for one', async () => {
    const book = { id: 'b', chapters: [] };
    const flow = await buildFlowEpub(db() as never, book, [{ id: 'p1', page_number: 420, printed_page: { label: '231' }, ocr: { data: OLAUS_420.ocr }, translation: { data: OLAUS_420.translation } }], { text: 'translation', baseUrl: 'https://x', includeImages: false });
    expect(flow.chapters[0].content).toMatch(/<a class="page-marker" id="p420"[^>]*>\|231<\/a>/);
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

  it('cuts a book with parts and chapters at its parts, its chapters nested under each in both contents (#8333)', async () => {
    // Olaus Magnus's shape: a book (level 1) whose first chapter (level 2) begins on the same page.
    const book = { id: 'b', chapters: [
      { title: 'Liber Primus', titleEn: 'Book One', pageNumber: 1, level: 1 }, { title: 'Cap. I', titleEn: 'Chap. I: On Biarmia', pageNumber: 1, level: 2 },
      { title: 'Cap. II', titleEn: 'Chap. II: On Finmarchia', pageNumber: 2, level: 2 },
      { title: 'Liber Secundus', titleEn: 'Book Two', pageNumber: 3, level: 1 }, { title: 'Cap. I', titleEn: 'Chap. I: On the combustion of waters', pageNumber: 4, level: 2 },
    ] };
    const flow = await buildFlowEpub(db() as never, book, pages(4), { text: 'translation', baseUrl: 'https://x', includeImages: false });
    expect(flow.chapters.map(c => c.title)).toEqual(['Book One', 'Book Two']);
    expect(flow.chapters[0].children).toEqual([{ title: 'Chap. I: On Biarmia', anchor: 'p1' }, { title: 'Chap. II: On Finmarchia', anchor: 'p2' }]);
    expect(flow.chapters[1].children).toEqual([{ title: 'Chap. I: On the combustion of waters', anchor: 'p4' }]);

    const zip = await JSZip.loadAsync(await renderFlowEpub({ title: 't', author: 'a', lang: 'en' } as never, flow.chapters, { hasImages: false, sourceUrl: 'https://x/book/b' }));
    const nav = await zip.file('OEBPS/toc.xhtml')!.async('string');
    expect(nav).toMatch(/Book One\s*<\/a><ol><li><a href="[^"]+#p1">Chap\. I: On Biarmia<\/a><\/li><li><a href="[^"]+#p2">Chap\. II: On Finmarchia<\/a><\/li><\/ol>/);
    const ncx = await zip.file('OEBPS/toc.ncx')!.async('string');
    const orders = [...ncx.matchAll(/playOrder="(\d+)"[\s\S]*?<content src="([^"]+)"/g)].map(m => [m[2], Number(m[1])] as const);
    expect(orders.length).toBe(1 + 2 + 3); // contents, two parts, three chapters
    for (const [src, n] of orders) expect(orders.filter(o => o[0] === src).every(o => o[1] === n)).toBe(true);
    expect(new Set(orders.map(o => o[1])).size).toBe(new Set(orders.map(o => o[0])).size);
    expect(ncx).toContain('<meta name="dtb:depth" content="2"/>');
  });

  it('marks each illustration where it stands, with a link, when the scans may not be redistributed', async () => {
    const rows = [{ page_number: 2, description: 'A furnace & bellows.' }, { page_number: 1, description: '' }];
    const flow = await buildFlowEpub(db(0, rows) as never, { id: 'b' }, pages(2), { text: 'translation', baseUrl: 'https://x', includeImages: false });
    expect(flow.imagesIncluded).toBe(0);
    expect(flow.imagesNote).toMatch(/not released for redistribution, so its 2 illustrations are not reproduced here: each is marked where it stands.*https:\/\/x\/book\/b/);
    const c = flow.chapters[0].content;
    expect(c).toContain('<figcaption><a href="https://x/book/b?page=2">Illustration, p. 2</a>: A furnace &amp; bellows.</figcaption>');
    expect(c).toContain('<figcaption><a href="https://x/book/b?page=1">Illustration, p. 1</a></figcaption>');
    expect(c).not.toContain('<img');
  });

  it('says once per run that transcribed pages are not yet translated, instead of skipping them silently', async () => {
    const ps = [
      { id: 'a', page_number: 1, translation: { data: 'It begins.' } },
      { id: 'b', page_number: 2, ocr: { data: 'Latina' } },
      { id: 'c', page_number: 3, ocr: { data: 'Latina' } },
      { id: 'd', page_number: 4, translation: { data: 'It goes on.' } },
    ];
    const flow = await buildFlowEpub(db() as never, { id: 'b' }, ps, { text: 'translation', baseUrl: 'https://x', includeImages: false });
    const c = flow.chapters[0].content;
    expect(c.match(/not yet translated/g)).toHaveLength(1);
    expect(c).toContain('Pages 2–3 are not yet translated; the original is at <a href="https://x/book/b?page=2">');
  });

  it('keeps a section whose pages are all untranslated, as its note — never drops it', async () => {
    const book = { id: 'b', chapters: [{ title: 'Liber I', pageNumber: 1 }, { title: 'Liber II', pageNumber: 2 }] };
    const ps = [{ id: 'a', page_number: 1, translation: { data: 'Done.' } }, { id: 'c', page_number: 2, ocr: { data: 'Latina' } }];
    const flow = await buildFlowEpub(db() as never, book, ps, { text: 'translation', baseUrl: 'https://x', includeImages: false });
    expect(flow.chapters.map(c => c.title)).toEqual(['Liber I', 'Liber II']);
    expect(flow.chapters[1].content).toContain('Page 2 is not yet translated');
  });

  it('says nothing about illustrations when the book has none', async () => {
    const flow = await buildFlowEpub(db(0) as never, { id: 'b' }, pages(2), { text: 'translation', baseUrl: 'https://x', includeImages: true });
    expect(flow.imagesNote).toBeNull();
  });
});
