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
import { facingTranslationLabel, facingTranslationOf, leafRole } from '@/lib/facing-translation';

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
.flow-figure-link { text-align: left; font-size: 0.85em; color: #555; border-left: 2px solid #ccc; padding-left: 0.8em; }
.noteref { font-size: 0.7em; vertical-align: super; line-height: 0; text-decoration: none; }
.footnotes { margin-top: 2em; border-top: 1px solid #ccc; font-size: 0.85em; }
.footnotes h3 { font-size: 1em; }
.footnote p { margin: 0.3em 0; text-align: left; }
`;

interface FlowBookDoc {
  id: string;
  chapters?: Array<{ title?: string; titleEn?: string; pageNumber?: number; level?: number; confidence?: string }>;
  thumbnail?: string | null;
  thumbnail_blob?: string | null;
  image_display?: string | null;
  image_thumb?: string | null;
  facing_translation?: unknown;
}
interface FlowPageDoc {
  id: string;
  page_number: number;
  page_type?: string;
  translation?: { data?: string } | null;
  ocr?: { data?: string } | null;
  printed_page?: { label?: unknown } | null;
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
    .replace(/<\/p>\s*<p>\s*((?:<a epub:type="noteref"[^>]*>\d+<\/a>\s*)+)<\/p>/g, ' $1</p>')
    // With no text before it (after a heading, at a section's start) or at the head of a paragraph, it joins the text
    // after it instead: a lone number on a line of its own is clutter on a 6-inch screen (#8333: 542 in Olaus Magnus).
    .replace(/<p>\s*((?:<a class="page-marker"[^>]*>[^<]*<\/a>\s*)?)((?:<a epub:type="noteref"[^>]*>\d+<\/a>\s*)+)(?:<br\/>\s*)+/g, '<p>$1$2 ')
    .replace(/<p>\s*((?:<a class="page-marker"[^>]*>[^<]*<\/a>\s*)?)((?:<a epub:type="noteref"[^>]*>\d+<\/a>\s*)+)<\/p>\s*<p>/g, '<p>$1$2 ');
  return notes.length ? `${body}\n<section class="footnotes"><h3>Notes</h3>\n${notes.join('\n')}\n</section>` : body;
}

/** Editorial blocks and one-line tags a page opens with: not text, so not the page's first line. */
const EDITORIAL_BLOCK = /<(meta|summary|keywords|vocab|scan-quality|warning|script)\b[^>]*>[\s\S]*?<\/\1>/g;
const TAG_LINE = /^<(page-num|language|page-type|header|sig|folio|columns)\b[^>]*>[\s\S]*?<\/\1>$|^<(?:page-type|language|columns)\b[^>]*\/?>$/;
/** A heading, or a line that is wholly bold or centred: how a translation sets a running head it carried over. */
const HEADING_LIKE = /^#{1,6}\s+\S|^(?:->)?\s*\*\*[^*]{2,120}\*\*\s*(?:<-)?$|^->.{2,120}<-$/;
const isHeadingLike = (line: string) => HEADING_LIKE.test(line) && line.replace(/<(note|gloss)\b[^>]*>[\s\S]*?<\/\1>/g, '').replace(/[#*\->< ]/g, '').length <= 80;
const contentLines = (text: string) => text.replace(EDITORIAL_BLOCK, m => '\n'.repeat(m.split('\n').length - 1)).split('\n')
  .map((l, i) => ({ i, l: l.replace(/[\u200b-\u200f\u2060-\u2064\ufeff]/g, '').trim() }))
  .filter(x => x.l && !TAG_LINE.test(x.l));

/**
 * The page's running head, when the translation carried it over as its first line (#8333). The transcription tags
 * page furniture (`<header>LIBER DECIMVS</header>`, `<page-num>231</page-num>`) and the export drops those tags, but a
 * translation often sets the header as a heading of its own ("# BOOK TEN", "->**HERODOTUS**<-"), so a running head
 * opened every page of the EPUB and broke the sentence running across it (Olaus Magnus: 143 of 915 pages).
 * The transcription is the witness: a header is dropped only when the OCR tags one AND the translation has one more
 * heading-like line than the OCR's own text, the extra one being the first. A chapter title at the top of a page is
 * in both texts, so the counts match and it stays (measured on Olaus, 2026-11-07: 143 dropped, all running heads;
 * 132 kept, all chapter titles). Export only: the stored text keeps every line (#7118).
 */
export function dropCarriedRunningHead(translation: string, ocr: string | null | undefined): string {
  if (!ocr || !/<header\b[^>]*>[\s\S]*?<\/header>/.test(ocr)) return translation;
  const tl = contentLines(translation);
  if (!tl.length || !isHeadingLike(tl[0].l)) return translation;
  const ocrHeads = contentLines(ocr).filter(x => isHeadingLike(x.l)).length;
  if (tl.filter(x => isHeadingLike(x.l)).length <= ocrHeads) return translation;
  const lines = translation.split('\n');
  lines.splice(tl[0].i, 1);
  return lines.join('\n');
}

/** A page's heading levels mapped, in order of depth, onto h3, h4, … (h6 at most): no level skipped. */
export function rankHeadings(html: string): string {
  const levels = [...new Set([...html.matchAll(/<h([1-6])>/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
  const rank = new Map(levels.map((l, i) => [l, Math.min(6, 3 + i)]));
  return html.replace(/<(\/?)h([1-6])>/g, (_m, sl: string, n: string) => `<${sl}h${rank.get(Number(n)) ?? 6}>`);
}

const escapeHtml =(s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One section of the EPUB; `children` are its chapters, listed under it in the contents (two levels at most). */
export interface FlowSection { title: string; content: string; children?: { title: string; anchor: string }[] }

export interface FlowEpub {
  chapters: FlowSection[];
  imagesTotal: number;
  imagesIncluded: number;
  /** One sentence for the front matter when the illustrations are not all there; null when they are. */
  imagesNote: string | null;
  /** The book's own cover as a local JPEG for the EPUB builder (`file://…`), or null: only when the scans may be
   *  redistributed, like the illustrations. Without one a Kindle library shows a grey placeholder. */
  cover: string | null;
  /** On a facing-page edition (a Loeb, #8321), who the English is by, for the title page; null otherwise. */
  translationCredit: string | null;
  /** Removes the temporary image files. Call after the EPUB is built. */
  cleanup: () => void;
}

/**
 * The book's illustrations, each placed on its page. Where the scans may be redistributed (`embed`), the best of them
 * up to the cap are fetched, recompressed and staged as files the EPUB builder embeds. Every illustration NOT embedded
 * — scans not released, over the cap, or a fetch that failed — still stands where it is, as a caption saying what it
 * shows with a link to see it on its page: a picture that vanishes reads as a book without one. Linking to the page
 * is fine whatever the scan licence. The plain-text edition takes the same captions (`embed` false).
 */
async function stageFigures(db: Db, bookId: string, pageNumbers: Set<number>, baseUrl: string, embed: boolean): Promise<{ byPage: Map<number, string>; total: number; included: number; dir: string | null; best: string | null }> {
  const rows = await db.collection('gallery_images')
    .find(galleryFilter({ bookId, minQuality: 0.5 }), { projection: { _id: 0, page_number: 1, extracted_url: 1, description: 1, bbox: 1, detection_index: 1, gallery_quality: 1 }, maxTimeMS: 10000 })
    .toArray()
    .catch(() => []) as unknown as Array<{ page_number: number; extracted_url?: string; description?: string; bbox?: { y?: number }; detection_index?: number; gallery_quality?: number }>;
  const imgs = rows.filter(r => pageNumbers.has(r.page_number))
    .sort((a, b) => a.page_number - b.page_number || (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0) || (a.detection_index ?? 0) - (b.detection_index ?? 0));
  const byPage = new Map<number, string>();
  if (imgs.length === 0) return { byPage, total: 0, included: 0, dir: null, best: null };
  const files = new Map<(typeof imgs)[number], string>();
  let dir: string | null = null;
  if (embed) {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), `flow-epub-${bookId}-`));
    dir = staging;
    // Over the cap, the best illustrations across the whole book, not the first N (which would strip every plate
    // from the book's later parts).
    const wanted = imgs.filter(i => i.extracted_url).sort((a, b) => (b.gallery_quality ?? 0) - (a.gallery_quality ?? 0)).slice(0, FLOW_EPUB_MAX_IMAGES);
    let next = 0;
    await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, async () => {
      for (let i = next++; i < wanted.length; i = next++) {
        const buf = await fetchAndCompressImage(wanted[i].extracted_url as string, { colour: true, width: 800, height: 1200 });
        if (!buf) continue;
        const file = path.join(staging, `fig-${i}.jpg`);
        fs.writeFileSync(file, buf);
        files.set(wanted[i], file);
      }
    }));
  }
  let best: { file: string; q: number } | null = null;
  for (const img of imgs) {
    const file = files.get(img);
    const description = (img.description || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const href = `${baseUrl}/book/${bookId}?page=${img.page_number}`;
    if (file && (!best || (img.gallery_quality ?? 0) > best.q)) best = { file, q: img.gallery_quality ?? 0 };
    byPage.set(img.page_number, (byPage.get(img.page_number) || '') + (file
      ? `<figure class="flow-figure"><img src="file://${file}" alt="${escapeHtml(description || 'Illustration')}"/></figure>`
      : `<figure class="flow-figure flow-figure-link" data-page="${img.page_number}"><figcaption><a href="${escapeHtml(href)}">Illustration, p. ${img.page_number}</a>${description ? `: ${escapeHtml(description)}` : ''}</figcaption></figure>`));
  }
  return { byPage, total: imgs.length, included: files.size, dir, best: (best as { file: string } | null)?.file ?? null };
}

export async function buildFlowEpub(
  db: Db,
  book: FlowBookDoc,
  pages: FlowPageDoc[],
  opts: { text: 'translation' | 'ocr'; baseUrl: string; includeImages: boolean },
): Promise<FlowEpub> {
  const readable = pages.filter(p => p.page_type !== 'digitizer-insert' && p.page_type !== 'archived-spread' && p.page_number >= 0);
  const figures = await stageFigures(db, book.id, new Set(readable.map(p => p.page_number)), opts.baseUrl, opts.includeImages);

  // A facing-page edition (a Loeb, #8321) prints its own English on the leaf opposite each original leaf. Each
  // text keeps its lane, as in /read, so no passage reads twice: the translation is the published English leaves'
  // own words (never our AI English of the Greek or Latin leaves), the original the Greek or Latin leaves alone.
  // A leaf out of the lane keeps its page marker and its plates, which join the next page's.
  const facing = facingTranslationOf(book);
  const role = (p: FlowPageDoc) => (facing ? leafRole(p.ocr?.data) : null);
  const outOfLane = (p: FlowPageDoc) => !!facing && role(p) === (opts.text === 'translation' ? 'original' : 'translation');
  // In the translation lane a Loeb's English leaf is its own words, and so is a leaf whose stored English was
  // withheld (#7100: a title page, the short last page of the introduction, the index head): it is English already,
  // and "not yet translated" would be false.
  const printedEnglish = (p: FlowPageDoc) => !!facing && opts.text === 'translation'
    && (role(p) === 'translation' || !p.translation?.data);
  const flowPage = (p: FlowPageDoc): FlowPage => {
    const raw = outOfLane(p) ? ''
      : opts.text === 'translation' && !printedEnglish(p)
      ? (p.translation?.data ? markForExport(dropCarriedRunningHead(p.translation.data, p.ocr?.data), book.id) : '')
      : (p.ocr?.data || '');
    // A page's own headings sit below the section's <h2>, ranked in the order the page uses them (h3, h4, …):
    // translators pick #-levels freely ("#" then "###"), and a heading that skips a level breaks the heading
    // navigation e-readers and screen readers rely on (the probe found 143 skips in 12 books).
    const html = raw.trim() ? rankHeadings(markdownToHtml(raw)) : '';
    // The number printed on the page where the book's numbering vouches for one, as in /read: the book's own
    // references ("see p. 279", its index) and a citation then find the page. The scan number stays in the link.
    const label = typeof p.printed_page?.label === 'string' && p.printed_page.label.trim() ? p.printed_page.label.trim() : undefined;
    return { n: p.page_number, html: html && html !== '<p></p>' ? html : null, href: `${opts.baseUrl}/book/${book.id}?page=${p.page_number}`, figures: figures.byPage.get(p.page_number), label };
  };
  // A transcribed page with no translation yet says so, once per run ("Pages 45–52 are not yet translated"),
  // instead of vanishing: the reader would otherwise take the gap for the book (no silent skips). It stands as
  // its own block, so no sentence runs across it.
  const untranslated = (p: FlowPageDoc) => opts.text === 'translation' && !outOfLane(p) && !printedEnglish(p)
    && !p.translation?.data && !!p.ocr?.data?.trim();
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
  const usable = (book.chapters || [])
    .filter(c => typeof c.pageNumber === 'number' && c.confidence !== 'low' && (c.titleEn || c.title))
    .map(c => ({ page: c.pageNumber as number, title: (c.titleEn || c.title) as string, level: typeof c.level === 'number' ? c.level : 1 }))
    .sort((a, b) => a.page - b.page);
  // A book with parts AND chapters (Olaus Magnus: 22 books, 769 chapters) is cut at its top level, and the chapters
  // under each part become nested contents entries that link to the chapter's page. 793 sections in one flat list is
  // a contents nobody scrolls; Kindle shows two levels (Kindle Publishing Guidelines 5.2, #8333).
  const topLevel = Math.min(...usable.map(c => c.level));
  const tops = usable.filter(c => c.level === topLevel);
  const nested = tops.length >= 2 && tops.length < usable.length;
  const starts = nested ? tops : usable;
  const subs = nested ? usable.filter(c => c.level !== topLevel) : [];
  const sections: { title: string; pages: FlowPageDoc[] }[] = [];
  for (const p of readable) {
    const chapter = starts.find(c => c.page === p.page_number);
    const startsRun = starts.length === 0 && (sections.length === 0 || sections[sections.length - 1].pages.length >= PAGES_PER_SECTION);
    if (sections.length === 0 || chapter || startsRun) sections.push({ title: chapter?.title || '', pages: [] });
    sections[sections.length - 1].pages.push(p);
  }
  const seq = { n: 0 };
  const chapters: FlowSection[] = sections
    .map(s => {
      const first = s.pages[0].page_number, last = s.pages[s.pages.length - 1].page_number;
      const title = s.title || (first === last ? `Page ${first}` : `Pages ${first}–${last}`);
      // Page numbers as an edition marks a page break, "|198" on the line: e-readers ignore most CSS, and a bare
      // raised number would read as one of the footnote calls.
      const body = footnotesFor(joinPagesHtml(flowPages(s.pages)), seq)
        .replace(/(<a class="page-marker"[^>]*>)([^<]+)<\/a>/g, '$1|$2</a>');
      // Every page carries its marker (id "p<n>"), so a chapter's entry lands on the page where it begins.
      const children = subs.filter(c => c.page >= first && c.page <= last && body.includes(`id="p${c.page}"`))
        .map(c => ({ title: c.title, anchor: `p${c.page}` }));
      return { title, content: `${s.title ? `<h2>${escapeHtml(s.title)}</h2>\n` : ''}${body}`, ...(children.length ? { children } : {}) };
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
    : !opts.includeImages ? `The scans of this book are not released for redistribution, so its ${figures.total} illustrations are not reproduced here: each is marked where it stands, with what it shows and a link to see it at ${opts.baseUrl}/book/${book.id}.`
    : figures.included < figures.total ? `${figures.included} of this book's ${figures.total} illustrations are reproduced${figures.total > FLOW_EPUB_MAX_IMAGES ? ` (an e-book carries at most ${FLOW_EPUB_MAX_IMAGES})` : ''}; each of the others is marked where it stands, with what it shows and a link to see it at ${opts.baseUrl}/book/${book.id}.`
    : null;

  return {
    chapters,
    imagesTotal: figures.total,
    imagesIncluded: figures.included,
    imagesNote,
    translationCredit: facing && opts.text === 'translation'
      ? `${facingTranslationLabel(book)}: the published English, printed facing the original, transcribed from the scan. Source Library's AI translation is not included.`
      : null,
    cover: cover ? `file://${cover}` : null,
    cleanup: () => {
      if (figures.dir) fs.rmSync(figures.dir, { recursive: true, force: true });
      if (coverFile) fs.rmSync(coverFile, { force: true });
    },
  };
}

type ZipFile = { async(kind: 'string'): Promise<string> };
type EpubZip = { file(path: string): ZipFile | null; file(path: string, data: string): unknown; generateAsync(o: object): Promise<Buffer> };
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  chapters: FlowSection[],
  meta: { hasImages: boolean; sourceUrl: string },
): Promise<Buffer> {
  const book = new EPub({ ...options, prependChapterTitles: false, numberChaptersInTOC: false }, chapters.map(({ children: _c, ...c }) => c));
  await book.render();
  const inner = book as unknown as { zip: EpubZip; content: Array<{ filename: string; content: string }> };
  const zip = inner.zip;

  const pages: { n: string; href: string }[] = [];
  for (const ch of inner.content) {
    // The page list names each page as its marker does (the printed number, else the scan's), without the bar.
    for (const m of ch.content.matchAll(/<a class="page-marker" id="p(\d+)"[^>]*>\|?([^<]+)<\/a>/g)) pages.push({ n: m[2], href: `${ch.filename}#p${m[1]}` });
  }
  const start = (inner.content[1] ?? inner.content[0]).filename;
  const nav = [
    '<nav epub:type="landmarks" id="landmarks" hidden="hidden"><h2>Guide</h2><ol>',
    '<li><a epub:type="toc" href="toc.xhtml">Contents</a></li>',
    `<li><a epub:type="bodymatter" href="${start}">Start of the text</a></li>`,
    '</ol></nav>',
    pages.length ? `<nav epub:type="page-list" id="page-list" hidden="hidden"><h2>Pages</h2><ol>${pages.map(p => `<li><a href="${p.href}">${p.n}</a></li>`).join('')}</ol></nav>` : '',
  ].join('\n');
  // A section's chapters, nested under it in both contents (the nav a Kindle reads, and the NCX older readers use).
  const nest = chapters.map((c, i) => ({ file: inner.content[i]?.filename, children: c.children || [] }))
    .filter(n => n.file && n.children.length && inner.content.length === chapters.length);
  let toc = await zip.file('OEBPS/toc.xhtml')?.async('string');
  if (toc) {
    for (const n of nest) {
      const list = n.children.map(c => `<li><a href="${n.file}#${c.anchor}">${escapeXml(c.title)}</a></li>`).join('');
      toc = toc.replace(new RegExp(`(<a href="${escapeRegExp(n.file as string)}">[\\s\\S]*?</a>)(\\s*</li>)`), `$1<ol>${list}</ol>$2`);
    }
    zip.file('OEBPS/toc.xhtml', toc.replace('</body>', `${nav}\n</body>`));
  }
  let ncx = nest.length ? await zip.file('OEBPS/toc.ncx')?.async('string') : null;
  if (ncx) {
    for (const n of nest) {
      const points = n.children.map((c, j) => `<navPoint id="sub_${n.file?.replace(/\W/g, '_')}_${j}" class="chapter"><navLabel><text>${escapeXml(c.title)}</text></navLabel><content src="${n.file}#${c.anchor}"/></navPoint>`).join('');
      ncx = ncx.replace(new RegExp(`(<content src="${escapeRegExp(n.file as string)}"/>)(\\s*</navPoint>)`), `$1${points}$2`);
    }
    // playOrder runs through every navPoint in reading order, nested ones included; two chapters that begin on the
    // same page share one target, and the NCX then requires them to share its playOrder.
    let order = 0;
    const orderOf = new Map<string, number>();
    ncx = ncx.replace(/<navPoint ([^>]*)>(\s*<navLabel>[\s\S]*?<\/navLabel>\s*<content src="([^"]*)")/g, (_m, attrs: string, rest: string, src: string) => {
      if (!orderOf.has(src)) orderOf.set(src, ++order);
      return `<navPoint ${attrs.replace(/\s*playOrder="\d+"/, '')} playOrder="${orderOf.get(src)}">${rest}`;
    })
      .replace(/<meta name="dtb:depth" content="\d+"\/>/, '<meta name="dtb:depth" content="2"/>');
    zip.file('OEBPS/toc.ncx', ncx);
  }

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
