// PRIOR ART: generateEpubDownload in src/app/api/books/[id]/download/route.ts (and its tenant twin) made one EPUB
// chapter per page — a hard break at every page turn on a Kindle — and dropped every illustration. src/lib/flow-join.ts
// (the continuous /read view) joins pages; this reuses it for the export, shared by both routes so they cannot drift.
/**
 * The continuous EPUB (#7118): the book as one reading text, for a Kindle or any e-reader.
 *
 * Pages run on where the sentence does (flow-join), with a small linked page number at every
 * boundary. Chapters are the book's own (when it has them), else runs of PAGES_PER_SECTION pages,
 * so the reader's table of contents stays usable. Illustrations stand in the text at their page,
 * as colour JPEGs within 800×1200 (the export's own recompressor; e-ink readers grey them themselves, a tablet
 * or the Kindle app keeps a coloured miniature coloured),
 * and ONLY when the book's scans may be redistributed (`classifyImageAccess` is 'open'): a crop is
 * part of the scan. When images are left out, or capped, the EPUB says so in its own front matter.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Db } from 'mongodb';
import { joinPagesHtml, type FlowPage } from '@/lib/flow-join';
import { markdownToHtml } from '@/lib/export-markdown-html';
import { markForExport } from '@/lib/provenance';
import { galleryFilter } from '@/lib/gallery-scope';
import { fetchAndCompressImage } from '@/lib/export-page-images';
import { EPub, type Options } from 'epub-gen-memory';
import { getBookThumbnailUrl } from '@/lib/utils';

export const PAGES_PER_SECTION = 40;
/** At ~40 KB each, 400 illustrations (Fludd's Utriusque cosmi has 402) keep the EPUB near 16 MB: inside Send to
 *  Kindle's email limit (50 MB) and a function's 300 s window (150 took 13 s, measured 2026-10-22). */
export const FLOW_EPUB_MAX_IMAGES = 400;
const IMAGE_CONCURRENCY = 6;

export const FLOW_EPUB_CSS = `
.page-marker { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 0.65em; vertical-align: baseline; color: #999; text-decoration: none; padding: 0 0.2em; }
.flow-footnote { font-size: 0.85em; color: #555; padding-left: 1em; }
.flow-figure { margin: 1.5em 0; text-align: center; page-break-inside: avoid; }
.flow-figure img { max-width: 100%; height: auto; }
.noteref { font-size: 0.7em; vertical-align: super; line-height: 0; text-decoration: none; }
.footnotes { margin-top: 2em; border-top: 1px solid #ccc; font-size: 0.85em; }
.footnotes h3 { font-size: 1em; }
.footnote p { margin: 0.3em 0; text-align: left; }
`;

interface FlowBookDoc {
  id: string;
  chapters?: Array<{ title?: string; titleEn?: string; pageNumber?: number; confidence?: string }>;
  thumbnail?: string | null;
  thumbnail_blob?: string | null;
  image_display?: string | null;
  image_thumb?: string | null;
}
interface FlowPageDoc {
  id: string;
  page_number: number;
  page_type?: string;
  translation?: { data?: string } | null;
  ocr?: { data?: string } | null;
}

/**
 * Notes become pop-up footnotes. Inline, the translator's notes (on 57% of pages, ~5 a page: "original: 'sub incude'",
 * a date, an identification) and the printed marginalia (21%, ~3 a page) put a bracketed aside into every other
 * sentence — measured on one page from each of 400 random books, 2026-10-22. As EPUB 3 footnotes (`noteref` →
 * `aside epub:type="footnote"`) a Kindle shows a small number in the text and the note in a pop-up when tapped; other
 * readers link to the note at the end of the section. Glosses and terms stay inline: a word or two, read in place.
 * `seq` numbers notes through the whole book so every id is unique; the visible number restarts per section.
 */
export function footnotesFor(html: string, seq: { n: number }): string {
  const notes: string[] = [];
  const body = html.replace(/<span class="(note|margin)">\[([\s\S]*?)\]<\/span>/g, (_m, kind: string, text: string) => {
    const id = ++seq.n;
    const shown = notes.length + 1;
    notes.push(`<aside epub:type="footnote" id="fn${id}" class="footnote"><p><a href="#fnref${id}">${shown}.</a> ${kind === 'margin' ? '<em>In the margin:</em> ' : ''}${text.trim()}</p></aside>`);
    return `<a epub:type="noteref" href="#fn${id}" id="fnref${id}" class="noteref">${shown}</a>`;
  })
    // A marginal note set on a line or paragraph of its own leaves its number stranded there; it belongs at the end
    // of the text it sat beside (Hariri, 2026-10-22: "^11 ^12" alone between paragraphs).
    .replace(/(?:<br\/>\s*)+((?:<a epub:type="noteref"[^>]*>\d+<\/a>\s*)+)(?=<br\/>|<\/p>)/g, ' $1')
    .replace(/<\/p>\s*<p>\s*((?:<a epub:type="noteref"[^>]*>\d+<\/a>\s*)+)<\/p>/g, ' $1</p>');
  return notes.length ? `${body}\n<section class="footnotes"><h3>Notes</h3>\n${notes.join('\n')}\n</section>` : body;
}

/** A page's heading levels mapped, in order of depth, onto h3, h4, … (h6 at most): no level skipped. */
export function rankHeadings(html: string): string {
  const levels = [...new Set([...html.matchAll(/<h([1-6])>/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
  const rank = new Map(levels.map((l, i) => [l, Math.min(6, 3 + i)]));
  return html.replace(/<(\/?)h([1-6])>/g, (_m, sl: string, n: string) => `<${sl}h${rank.get(Number(n)) ?? 6}>`);
}

const escapeHtml =(s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface FlowEpub {
  chapters: { title: string; content: string }[];
  imagesTotal: number;
  imagesIncluded: number;
  /** One sentence for the front matter when the illustrations are not all there; null when they are. */
  imagesNote: string | null;
  /** The book's own cover as a local JPEG for the EPUB builder (`file://…`), or null: only when the scans may be
   *  redistributed, like the illustrations. Without one a Kindle library shows a grey placeholder. */
  cover: string | null;
  /** Removes the temporary image files. Call after the EPUB is built. */
  cleanup: () => void;
}

/** Fetch, recompress and stage the book's illustrations as files the EPUB builder embeds. */
async function stageFigures(db: Db, bookId: string, pageNumbers: Set<number>): Promise<{ byPage: Map<number, string>; total: number; included: number; dir: string | null; best: string | null }> {
  const rows = await db.collection('gallery_images')
    .find(galleryFilter({ bookId, minQuality: 0.5 }), { projection: { _id: 0, page_number: 1, extracted_url: 1, description: 1, bbox: 1, detection_index: 1, gallery_quality: 1 }, maxTimeMS: 10000 })
    .toArray()
    .catch(() => []) as unknown as Array<{ page_number: number; extracted_url: string; description?: string; bbox?: { y?: number }; detection_index?: number; gallery_quality?: number }>;
  const imgs = rows.filter(r => pageNumbers.has(r.page_number));
  const byPage = new Map<number, string>();
  if (imgs.length === 0) return { byPage, total: 0, included: 0, dir: null, best: null };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `flow-epub-${bookId}-`));
  // Over the cap, the best illustrations across the whole book, not the first N (which would strip every plate
  // from the book's later parts); then back into reading order.
  const wanted = [...imgs].sort((a, b) => (b.gallery_quality ?? 0) - (a.gallery_quality ?? 0)).slice(0, FLOW_EPUB_MAX_IMAGES)
    .sort((a, b) => a.page_number - b.page_number || (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0) || (a.detection_index ?? 0) - (b.detection_index ?? 0));
  const files: (string | null)[] = new Array(wanted.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, async () => {
    for (let i = next++; i < wanted.length; i = next++) {
      const buf = await fetchAndCompressImage(wanted[i].extracted_url, { colour: true, width: 800, height: 1200 });
      if (!buf) continue;
      const file = path.join(dir, `fig-${i}.jpg`);
      fs.writeFileSync(file, buf);
      files[i] = file;
    }
  }));
  let included = 0;
  let best: { file: string; q: number } | null = null;
  wanted.forEach((img, i) => {
    if (!files[i]) return;
    included++;
    if (!best || (img.gallery_quality ?? 0) > best.q) best = { file: files[i] as string, q: img.gallery_quality ?? 0 };
    const alt = escapeHtml((img.description || 'Illustration').slice(0, 300));
    byPage.set(img.page_number, (byPage.get(img.page_number) || '') + `<figure class="flow-figure"><img src="file://${files[i]}" alt="${alt}"/></figure>`);
  });
  return { byPage, total: imgs.length, included, dir, best: (best as { file: string } | null)?.file ?? null };
}

/**
 * The book's illustrations as captions only, no image fetched: for the plain-text edition, which cannot carry a
 * picture but can say where one stands and what it shows. Linking to the page is fine whatever the scan licence.
 */
async function figureCaptions(db: Db, bookId: string, pageNumbers: Set<number>, baseUrl: string): Promise<{ byPage: Map<number, string>; total: number; included: number; dir: null; best: null }> {
  const rows = await db.collection('gallery_images')
    .find(galleryFilter({ bookId, minQuality: 0.5 }), { projection: { _id: 0, page_number: 1, description: 1, bbox: 1, detection_index: 1 }, maxTimeMS: 10000 })
    .toArray()
    .catch(() => []) as unknown as Array<{ page_number: number; description?: string; bbox?: { y?: number }; detection_index?: number }>;
  const imgs = rows.filter(r => pageNumbers.has(r.page_number))
    .sort((a, b) => a.page_number - b.page_number || (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0) || (a.detection_index ?? 0) - (b.detection_index ?? 0));
  const byPage = new Map<number, string>();
  for (const img of imgs) {
    const caption = escapeHtml((img.description || '').replace(/\s+/g, ' ').trim().slice(0, 300));
    byPage.set(img.page_number, (byPage.get(img.page_number) || '')
      + `<figure class="flow-figure" data-page="${img.page_number}" data-href="${escapeHtml(`${baseUrl}/book/${bookId}?page=${img.page_number}`)}"><figcaption>${caption}</figcaption></figure>`);
  }
  return { byPage, total: imgs.length, included: imgs.length, dir: null, best: null };
}

export async function buildFlowEpub(
  db: Db,
  book: FlowBookDoc,
  pages: FlowPageDoc[],
  opts: { text: 'translation' | 'ocr'; baseUrl: string; includeImages: boolean; figureCaptions?: boolean },
): Promise<FlowEpub> {
  const readable = pages.filter(p => p.page_type !== 'digitizer-insert' && p.page_type !== 'archived-spread' && p.page_number >= 0);
  const figures = opts.includeImages
    ? await stageFigures(db, book.id, new Set(readable.map(p => p.page_number)))
    : opts.figureCaptions
    ? await figureCaptions(db, book.id, new Set(readable.map(p => p.page_number)), opts.baseUrl)
    : { byPage: new Map<number, string>(), total: await db.collection('gallery_images').countDocuments(galleryFilter({ bookId: book.id, minQuality: 0.5 }), { maxTimeMS: 5000 }).catch(() => 0), included: 0, dir: null, best: null };

  const flowPage = (p: FlowPageDoc): FlowPage => {
    const raw = opts.text === 'translation'
      ? (p.translation?.data ? markForExport(p.translation.data, book.id) : '')
      : (p.ocr?.data || '');
    // A page's own headings sit below the section's <h2>, ranked in the order the page uses them (h3, h4, …):
    // translators pick #-levels freely ("#" then "###"), and a heading that skips a level breaks the heading
    // navigation e-readers and screen readers rely on (the probe found 143 skips in 12 books).
    const html = raw.trim() ? rankHeadings(markdownToHtml(raw)) : '';
    return { n: p.page_number, html: html && html !== '<p></p>' ? html : null, href: `${opts.baseUrl}/book/${book.id}?page=${p.page_number}`, figures: figures.byPage.get(p.page_number) };
  };
  // A transcribed page with no translation yet says so, once per run ("Pages 45–52 are not yet translated"),
  // instead of vanishing: the reader would otherwise take the gap for the book (no silent skips). It stands as
  // its own block, so no sentence runs across it.
  const untranslated = (p: FlowPageDoc) => opts.text === 'translation' && !p.translation?.data && !!p.ocr?.data?.trim();
  const flowPages = (list: FlowPageDoc[]): FlowPage[] => list.map((p, i) => {
    const fp = flowPage(p);
    if (!untranslated(p) || (i > 0 && untranslated(list[i - 1]))) return fp;
    let j = i;
    while (j + 1 < list.length && untranslated(list[j + 1])) j++;
    const a = p.page_number, b = list[j].page_number;
    const what = a === b ? `Page ${a} is` : `Pages ${a}–${b} are`;
    return { ...fp, block: true, html: `<p class="untranslated"><em>${what} not yet translated; the original is at <a href="${opts.baseUrl}/book/${book.id}?page=${a}">${opts.baseUrl}/book/${book.id}?page=${a}</a>.</em></p>` };
  });

  // Sections: the book's chapters when it has them (low-confidence ones are guesses), else even runs of pages.
  const starts = (book.chapters || [])
    .filter(c => typeof c.pageNumber === 'number' && c.confidence !== 'low' && (c.titleEn || c.title))
    .map(c => ({ page: c.pageNumber as number, title: (c.titleEn || c.title) as string }))
    .sort((a, b) => a.page - b.page);
  const sections: { title: string; pages: FlowPageDoc[] }[] = [];
  for (const p of readable) {
    const chapter = starts.find(c => c.page === p.page_number);
    const startsRun = starts.length === 0 && (sections.length === 0 || sections[sections.length - 1].pages.length >= PAGES_PER_SECTION);
    if (sections.length === 0 || chapter || startsRun) sections.push({ title: chapter?.title || '', pages: [] });
    sections[sections.length - 1].pages.push(p);
  }
  const seq = { n: 0 };
  const chapters = sections
    .map(s => {
      const first = s.pages[0].page_number, last = s.pages[s.pages.length - 1].page_number;
      const title = s.title || (first === last ? `Page ${first}` : `Pages ${first}–${last}`);
      // Page numbers as an edition marks a page break, "|198" on the line: e-readers ignore most CSS, and a bare
      // raised number would read as one of the footnote calls.
      const body = footnotesFor(joinPagesHtml(flowPages(s.pages)), seq)
        .replace(/(<a class="page-marker"[^>]*>)(\d+)<\/a>/g, '$1|$2</a>');
      return { title, content: `${s.title ? `<h2>${escapeHtml(s.title)}</h2>\n` : ''}${body}` };
    })
    // Any content at all — a section of untranslated pages is its "not yet translated" note, not nothing.
    .filter(c => /<p[\s>]|<figure|<table|<ul/.test(c.content));

  // The cover: the book's own image, recompressed to a JPEG within Kindle's recommended 1600×2560 (the stored
  // thumbnail may be AVIF, which no e-reader reads). Only when the scans may be redistributed.
  let coverFile: string | null = null;
  const coverUrl = opts.includeImages ? getBookThumbnailUrl(book, 'display') : null;
  if (coverUrl) {
    const buf = await fetchAndCompressImage(coverUrl, { colour: true, width: 1600, height: 2560 });
    if (buf) {
      coverFile = path.join(os.tmpdir(), `flow-epub-cover-${book.id}-${process.pid}.jpg`);
      fs.writeFileSync(coverFile, buf);
    }
  }
  // The stored cover could not be fetched (Gallica answers 403 to a server): the book's best illustration stands in,
  // one of its own plates rather than a grey placeholder. It is already staged; cleanup removes it with the rest.
  const cover = coverFile ?? figures.best;

  const imagesNote = figures.total === 0 ? null
    : !opts.includeImages ? `This edition carries the text only: the scans of this book are not released for redistribution, so its ${figures.total} illustrations are not included. They can be seen at ${opts.baseUrl}/book/${book.id}.`
    : figures.included < figures.total ? `${figures.included} of this book's ${figures.total} illustrations are included${figures.total > FLOW_EPUB_MAX_IMAGES ? ` (an e-book carries at most ${FLOW_EPUB_MAX_IMAGES})` : ''}; all of them can be seen at ${opts.baseUrl}/book/${book.id}.`
    : null;

  return {
    chapters,
    imagesTotal: figures.total,
    imagesIncluded: figures.included,
    imagesNote,
    cover: cover ? `file://${cover}` : null,
    cleanup: () => {
      if (figures.dir) fs.rmSync(figures.dir, { recursive: true, force: true });
      if (coverFile) fs.rmSync(coverFile, { force: true });
    },
  };
}

type ZipFile = { async(kind: 'string'): Promise<string> };
type EpubZip = { file(path: string): ZipFile | null; file(path: string, data: string): unknown; generateAsync(o: object): Promise<Buffer> };
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Build the EPUB, then add what epub-gen-memory does not write and the Kindle publishing guidelines and EPUB
 * Accessibility 1.1 ask for (checked with EPUBCheck 5.1, 2026-10-22):
 *  - landmarks: where the text starts (a Kindle's "Go to Beginning") and the contents;
 *  - a page list: the book's page numbers (the '|198' markers), for "go to page" and real page numbers;
 *  - the pagination source (dc:source + source-of), which EPUBCheck requires beside a page list;
 *  - accessibility metadata: access modes, features (alt text, contents, page navigation), hazards, a summary.
 * Chapter titles are not prepended (each titled section already opens with its heading; an untitled one would
 * get a "Pages 1–40" heading in the middle of the text) and the contents are not numbered.
 */
export async function renderFlowEpub(
  options: Options,
  chapters: { title: string; content: string }[],
  meta: { hasImages: boolean; sourceUrl: string },
): Promise<Buffer> {
  const book = new EPub({ ...options, prependChapterTitles: false, numberChaptersInTOC: false }, chapters);
  await book.render();
  const inner = book as unknown as { zip: EpubZip; content: Array<{ filename: string; content: string }> };
  const zip = inner.zip;

  const pages: { n: string; href: string }[] = [];
  for (const ch of inner.content) {
    for (const m of ch.content.matchAll(/<a class="page-marker" id="p(\d+)"/g)) pages.push({ n: m[1], href: `${ch.filename}#p${m[1]}` });
  }
  const start = (inner.content[1] ?? inner.content[0]).filename;
  const nav = [
    '<nav epub:type="landmarks" id="landmarks" hidden="hidden"><h2>Guide</h2><ol>',
    '<li><a epub:type="toc" href="toc.xhtml">Contents</a></li>',
    `<li><a epub:type="bodymatter" href="${start}">Start of the text</a></li>`,
    '</ol></nav>',
    pages.length ? `<nav epub:type="page-list" id="page-list" hidden="hidden"><h2>Pages</h2><ol>${pages.map(p => `<li><a href="${p.href}">${p.n}</a></li>`).join('')}</ol></nav>` : '',
  ].join('\n');
  const toc = await zip.file('OEBPS/toc.xhtml')?.async('string');
  if (toc) zip.file('OEBPS/toc.xhtml', toc.replace('</body>', `${nav}\n</body>`));

  const feature = (f: string) => `<meta property="schema:accessibilityFeature">${f}</meta>`;
  const a11y = [
    pages.length ? `<dc:source id="pagination-source">${escapeXml(meta.sourceUrl)}</dc:source>\n<meta refines="#pagination-source" property="source-of">pagination</meta>` : '',
    '<meta property="schema:accessMode">textual</meta>',
    meta.hasImages ? '<meta property="schema:accessMode">visual</meta>' : '',
    '<meta property="schema:accessModeSufficient">textual</meta>',
    meta.hasImages ? feature('alternativeText') : '',
    feature('tableOfContents'), feature('readingOrder'), feature('displayTransformability'),
    pages.length ? `${feature('pageNavigation')}\n${feature('pageBreakMarkers')}` : '',
    '<meta property="schema:accessibilityHazard">none</meta>',
    `<meta property="schema:accessibilitySummary">${escapeXml(`Reflowable text in reading order, with a table of contents${pages.length ? ' and the page numbers of the scanned book' : ''}. Notes are linked footnotes.${meta.hasImages ? ' Every illustration carries a text description.' : ''}`)}</meta>`,
  ].filter(Boolean).join('\n');
  const opf = await zip.file('OEBPS/content.opf')?.async('string');
  if (opf) zip.file('OEBPS/content.opf', opf.replace('</metadata>', `${a11y}\n</metadata>`));

  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}
