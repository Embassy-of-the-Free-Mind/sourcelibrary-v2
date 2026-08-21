/**
 * Shared layout helpers for the pdf-translation / pdf-facsimile download
 * formats (issue #3283). Used by both `src/app/api/books/[id]/download/route.ts`
 * and its tenant twin `src/app/api/[tenant]/books/[id]/download/route.ts`.
 *
 * Deliberately does NOT own image fetching — each route file keeps its own
 * `pageExportImageUrl()` / `fetchPageImagesOrdered()` (the canonical
 * `getPageImageUrl()` resolver + bounded-concurrency fetcher), matching the
 * existing per-route pattern for every other format in this codebase. This
 * module only owns the parts that are pure text/layout and would otherwise be
 * copy-pasted verbatim between the two files: translation text cleanup and
 * the front-matter/colophon boilerplate.
 */
import PDFDocument from 'pdfkit';
import { markForExport } from '@/lib/provenance';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { normalizeAnnotationSpans } from '@/lib/normalize-annotation-spans';
import { registerPdfFonts, type PdfFontNames } from '@/lib/pdf-fonts';

export const PDF_MARGINS = { top: 72, bottom: 72, left: 72, right: 72 };

/**
 * Page-physical metadata tags that describe the scan/page rather than
 * transcribe it — dropped entirely (content and all). Mirrors the drop-list
 * in this route's `markdownToHtml()`.
 */
const PDF_METADATA_TAGS =
  'lang|language|page-num|page-type|folio|sig|header|meta|warning|abbrev|vocab|summary|keywords|columns|detected-images|blockquote';
const PDF_METADATA_TAG_RE = new RegExp(`<(${PDF_METADATA_TAGS})>[\\s\\S]*?<\\/\\1>`, 'gi');

/**
 * Inline annotation tags that survive cleaning and render as COLORED runs in
 * the PDF, matching the reader's chip colors (`NOTE_TAG_STYLES` in
 * src/lib/style-constants.ts, light theme). A paying reader asked for exactly
 * this — "I like the colour coding of text when you are providing context
 * within the translation, can we keep that?" (feedback, 2026-08-10) — so the
 * PDF keeps the same semantic color language as the site. Italic doubles the
 * signal so the distinction survives grayscale printing.
 */
export const PDF_ANNOTATION_STYLES: Record<
  string,
  { color: string; italic: boolean; suffix?: string }
> = {
  note: { color: '#9e7c3c', italic: true }, // editorial note — gold
  'image-desc': { color: '#9e7c3c', italic: true }, // AI image description — gold
  margin: { color: '#5e6d52', italic: false }, // marginal note in original — sage
  insert: { color: '#5e6d52', italic: false }, // later insertion — sage
  gloss: { color: '#7c5db5', italic: false }, // gloss/annotation in original — violet
  term: { color: '#7c5db5', italic: true }, // technical term — violet
  unclear: { color: '#78716c', italic: true, suffix: '?' }, // uncertain reading — gray
};

const ANNOTATION_TAG_NAMES = Object.keys(PDF_ANNOTATION_STYLES).join('|');
// Open tags may carry attributes (<image-desc size="large">) — allow and drop them.
const ANNOTATION_RUN_RE = new RegExp(
  `<(${ANNOTATION_TAG_NAMES})(?:\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`,
  'gi'
);

/**
 * Normalize the inline markup translation text carries, KEEPING the annotation
 * tags above (they become colored runs at render time) and flattening or
 * dropping everything else.
 *
 * Call order matters: runs AFTER stripEditorialWrappers() and BEFORE
 * markForExport() — see `cleanTranslationForPdf` below, the entry point every
 * caller should use.
 */
function normalizeTagsForPdf(text: string): string {
  let out = text;

  // Markdown image syntax + bare URLs don't render as inline images/links in
  // flowing PDF text.
  out = out.replace(/!\[.*?\]\(.*?\)/g, '');
  out = out.replace(/https?:\/\/[^\s)]+/g, '');

  // Legacy bracket syntax → XML, so one render path handles both vintages.
  out = out.replace(/\[\[image:\s*[\s\S]*?\]\]/gi, '');
  out = out.replace(/\[\[(notes?):\s*([\s\S]*?)\]\]/gi, '<note>$2</note>');
  out = out.replace(/\[\[margin:\s*([\s\S]*?)\]\]/gi, '<margin>$1</margin>');
  out = out.replace(/\[\[gloss:\s*([\s\S]*?)\]\]/gi, '<gloss>$1</gloss>');
  out = out.replace(/\[\[insert:\s*([\s\S]*?)\]\]/gi, '<insert>$1</insert>');
  out = out.replace(/\[\[unclear:\s*([\s\S]*?)\]\]/gi, '<unclear>$1</unclear>');
  out = out.replace(/\[\[term:\s*([\s\S]*?)\]\]/gi, '<term>$1</term>');

  out = out.replace(/<column-break\s*\/?>/gi, '\n\n');
  out = out.replace(/<page-break\s*\/?>/gi, '');

  // Page-physical metadata tags — drop entirely (content and all).
  out = out.replace(PDF_METADATA_TAG_RE, '');

  // Rewrite annotation spans into balanced, non-nested, single-paragraph tag
  // pairs (#2709) — the same pass the reader runs. The lazy pairing regex in
  // parseStyledLines() below needs well-formed spans or a nested note strands
  // the outer note's tail as body text.
  out = normalizeAnnotationSpans(out);

  // Safety net for any OTHER tag: strip the markup, keep the content — real
  // page text should never be silently eaten by an unhandled tag. Annotation
  // tags are exempted (they carry the color styling through to render time).
  out = out.replace(/<\/?([a-z][a-z0-9-]*)(?:\s[^>]*)?\/?>/gi, (m, name) =>
    PDF_ANNOTATION_STYLES[String(name).toLowerCase()] ? m : ''
  );

  return out.trim();
}

/** Strip annotation tags, keeping their content — for contexts that can't
 * carry color (table cells, plain-text fallbacks). `unclear` keeps its "?". */
export function stripAnnotationTags(text: string): string {
  return text.replace(ANNOTATION_RUN_RE, (_, name, content) => {
    const style = PDF_ANNOTATION_STYLES[String(name).toLowerCase()];
    return style?.suffix ? `${content}${style.suffix}` : content;
  });
}

/**
 * Clean a page's raw translation text for PDF rendering:
 *   1. stripEditorialWrappers() — removes AI page-description wrapper blocks
 *      (never verbatim source, see CLAUDE.md "Quote & snippet integrity") and
 *      flattens markdown markup (headers/bold/italic/tables/->centered<-).
 *   2. normalizeTagsForPdf() — legacy brackets → XML, metadata tags dropped,
 *      annotation spans normalized and KEPT (rendered as colored runs).
 *   3. markForExport() — invisible zero-width provenance mark (same as every
 *      other download format).
 */
export function cleanTranslationForPdf(raw: string, bookId: string): string {
  if (!raw) return '';
  // keepTables — a downloaded edition is the whole text, not a snippet. The
  // default flattening keeps every cell value but discards the column it
  // belonged to; `writePdfBody()` below lays the surviving markup out as a real
  // PDF table instead. (40% of pages in a manuscript like Kitab al-Bulhan are
  // calendar/abjad tables, so this is not an edge case.)
  const stripped = stripEditorialWrappers(raw, { keepTables: true });
  return markForExport(normalizeTagsForPdf(stripped), bookId);
}

/** A run of page text: either flowing prose or a GFM table. */
export type PdfBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; rows: string[][]; hasHeader: boolean };

const TABLE_ROW_RE = /^[ \t]*\|(.+)\|[ \t]*$/;
/** GFM alignment/separator row — cells are only dashes with optional colons. */
const TABLE_SEPARATOR_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;

const splitRow = (line: string): string[] =>
  (line.match(TABLE_ROW_RE)?.[1] ?? '').split('|').map(c => c.trim());

/**
 * Split cleaned page text into prose and table blocks so each can be laid out
 * with the right pdfkit primitive. A table is a maximal run of consecutive
 * pipe-delimited lines; its separator row marks the preceding row as a header.
 *
 * Exported for testing — `writePdfBody()` is the normal entry point.
 */
export function splitPdfBlocks(text: string): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  let prose: string[] = [];
  let rows: string[][] = [];
  let hasHeader = false;

  const flushProse = () => {
    const t = prose.join('\n').trim();
    if (t) blocks.push({ kind: 'text', text: t });
    prose = [];
  };
  const flushTable = () => {
    // Drop a fully-empty header row ("| | |") — common in OCR'd tables and it
    // would render as a band of blank cells.
    if (rows.length && rows[0].every(c => !c)) {
      rows.shift();
      hasHeader = false;
    }
    if (rows.length) {
      // RECTANGULARIZE. OCR'd tables are frequently ragged — a damaged or
      // merged cell drops a pipe, so row lengths vary within one table (a real
      // page in Kitab al-Bulhan yields rows of 9, 10 and 11 cells). pdfkit sizes
      // columns from the widest declared row and then throws
      // "unsupported number: undefined" on any cell past that, killing the whole
      // download. Pad short rows so the block invariant is "rectangular".
      const width = Math.max(...rows.map(r => r.length));
      rows = rows.map(r => (r.length === width ? r : [...r, ...Array(width - r.length).fill('')]));
      blocks.push({ kind: 'table', rows, hasHeader });
    }
    rows = [];
    hasHeader = false;
  };

  for (const line of text.split('\n')) {
    if (TABLE_SEPARATOR_RE.test(line) && rows.length) {
      // The row already collected is the header.
      hasHeader = true;
      continue;
    }
    if (TABLE_ROW_RE.test(line)) {
      if (!rows.length) flushProse();
      rows.push(splitRow(line));
      continue;
    }
    if (rows.length) flushTable();
    prose.push(line);
  }
  flushTable();
  flushProse();
  return blocks;
}

/**
 * Arabic-script range (incl. supplement, extended-A and the presentation forms).
 * Deliberately does NOT include Latin, so a transliteration like "durrī" stays
 * on the Latin face.
 */
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
/** A run is Arabic if it holds Arabic letters; adjacent spaces/punctuation ride along. */
const ARABIC_RUN_RE =
  /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿][؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿\s،؛؟]*/g;

/** Split text into alternating Latin / Arabic runs, preserving order. */
export function splitScriptRuns(text: string): Array<{ arabic: boolean; text: string }> {
  if (!ARABIC_RE.test(text)) return [{ arabic: false, text }];
  const runs: Array<{ arabic: boolean; text: string }> = [];
  let last = 0;
  for (const m of text.matchAll(ARABIC_RUN_RE)) {
    const start = m.index ?? 0;
    if (start > last) runs.push({ arabic: false, text: text.slice(last, start) });
    runs.push({ arabic: true, text: m[0] });
    last = start + m[0].length;
  }
  if (last < text.length) runs.push({ arabic: false, text: text.slice(last) });
  return runs;
}

/** One render unit: a piece of a single visual line with one annotation style.
 * `style` is null for body text, else a key of PDF_ANNOTATION_STYLES. */
export interface StyledRun {
  style: string | null;
  text: string;
}

/**
 * Split cleaned page text into LINES of styled runs. Annotation spans become
 * styled runs (their tags consumed); everything else is body text. A span
 * whose content wraps across newlines is split so that the line-scoped
 * `continued` chaining below still works — style carries across the split.
 *
 * Exported for testing — `writePdfBody()` is the normal entry point.
 */
export function parseStyledLines(text: string): StyledRun[][] {
  const runs: StyledRun[] = [];
  let last = 0;
  ANNOTATION_RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANNOTATION_RUN_RE.exec(text)) !== null) {
    if (m.index > last) runs.push({ style: null, text: text.slice(last, m.index) });
    const style = m[1].toLowerCase();
    const suffix = PDF_ANNOTATION_STYLES[style]?.suffix ?? '';
    runs.push({ style, text: m[2] + suffix });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ style: null, text: text.slice(last) });

  const lines: StyledRun[][] = [[]];
  for (const run of runs) {
    run.text.split('\n').forEach((piece, i) => {
      if (i > 0) lines.push([]);
      if (piece) lines[lines.length - 1].push({ style: run.style, text: piece });
    });
  }
  return lines;
}

/**
 * Write a string that may mix Latin and Arabic AND carry colored annotation
 * runs, switching face and fill color per run.
 *
 * Script-splitting facts, both verified by rendering (2026-08-03):
 *  - Noto Serif has NO Arabic glyphs, so Arabic inside translation glosses
 *    (`<note>original: "دري اللون"…`) rendered as .notdef boxes — 97 of 366
 *    pages on Kitab al-Bulhan.
 *  - Noto Naskh Arabic has no Latin glyphs, so simply swapping the document
 *    font inverts the problem. Only per-run switching works.
 *
 * The `rtla` OpenType feature is REQUIRED on Arabic runs. Without it pdfkit
 * shapes the letters and orders the words correctly but DROPS the inter-word
 * spaces ("قارعت الاثنين" → "الاثنينقارعت"), which silently alters the text —
 * unacceptable in an edition that gets cited. With it, spacing is correct.
 *
 * Continuation is scoped to ONE LINE. `continued: true` resumes at the
 * current x, and an embedded "\n" inside a continued run does not reset it —
 * so a single chain over multi-line text indents every line after the first
 * to wherever the previous run happened to end. (Caught by rendering the full
 * book: page 195 showed "hoping? for God's mercy" starting mid-measure.)
 * parseStyledLines() pre-splits on newlines so each chain covers one line.
 */
function writeStyledText(
  doc: PDFKit.PDFDocument,
  fonts: PdfFontNames,
  text: string,
  opts: { fontSize: number; lineGap?: number },
): void {
  const { fontSize, lineGap = 3 } = opts;
  for (const line of parseStyledLines(text)) {
    if (line.length === 0) {
      doc.font(fonts.regular).fontSize(fontSize).fillColor('#000000').text(' ', { lineGap });
      continue;
    }
    // Flatten [annotation runs] × [script runs] into one draw list for the line.
    const draws: Array<{ style: string | null; arabic: boolean; text: string }> = [];
    for (const run of line) {
      // When the Arabic face is missing we deliberately keep the .notdef boxes
      // rather than dropping the text — a visible gap is honest,
      // silently-deleted source is not.
      const scriptRuns = fonts.arabic ? splitScriptRuns(run.text) : [{ arabic: false, text: run.text }];
      for (const s of scriptRuns) draws.push({ style: run.style, arabic: s.arabic, text: s.text });
    }
    draws.forEach((d, i) => {
      const ann = d.style ? PDF_ANNOTATION_STYLES[d.style] : undefined;
      const face = d.arabic ? fonts.arabic! : ann?.italic ? fonts.italic : fonts.regular;
      doc
        .font(face)
        .fontSize(fontSize)
        .fillColor(ann?.color ?? '#000000')
        .text(d.text, {
          lineGap,
          continued: i < draws.length - 1,
          ...(d.arabic ? { features: ['rtla'] } : {}),
        });
    });
  }
  doc.font(fonts.regular).fontSize(fontSize).fillColor('#000000');
}

/**
 * Render a page's cleaned text, laying GFM tables out as real PDF tables
 * (pdfkit >= 0.16 `doc.table()`) rather than as flattened digit runs.
 *
 * Falls back to plain text if the installed pdfkit has no table support, so a
 * version skew degrades the layout instead of 500ing the download.
 */
export function writePdfBody(
  doc: PDFKit.PDFDocument,
  fonts: PdfFontNames,
  text: string,
  opts: { fontSize: number; lineGap?: number },
): void {
  const { fontSize, lineGap = 3 } = opts;
  const canTable = typeof (doc as { table?: unknown }).table === 'function';

  for (const block of splitPdfBlocks(text)) {
    if (block.kind === 'text') {
      writeStyledText(doc, fonts, block.text, { fontSize, lineGap });
      continue;
    }
    // Table cells can't carry per-run color — unwrap annotation tags there.
    block.rows = block.rows.map(r => r.map(stripAnnotationTags));
    if (!canTable) {
      // Keep the pipes — unaligned, but the column each value belongs to is
      // still recoverable, unlike a flattened run.
      doc.font(fonts.regular).fontSize(fontSize).text(
        block.rows.map(r => r.join(' | ')).join('\n'), { lineGap });
      continue;
    }
    // Wide tables (some run 16-18 columns) need a smaller face to stay legible
    // inside the A4 text block.
    const cols = Math.max(...block.rows.map(r => r.length));
    const cellSize = cols >= 12 ? 6.5 : cols >= 8 ? 7.5 : Math.min(fontSize, 9);
    doc.moveDown(0.4);
    // Set the face on the document so every cell inherits it; only the header
    // row overrides, so a table never silently falls back to a Latin-only
    // built-in face mid-way through.
    doc.font(fonts.regular).fontSize(cellSize);
    doc.table({
      data: block.rows.map((row, i) => {
        const isHeader = block.hasHeader && i === 0;
        return row.map(cell => {
          // A cell can be Arabic too (untranslated headings inside a table).
          // Same rule as writeScriptAwareText: only switch when a face exists.
          const face = fonts.arabic && ARABIC_RE.test(cell)
            ? fonts.arabic
            : isHeader ? fonts.bold : fonts.regular;
          return {
            text: cell,
            type: (isHeader ? 'TH' : 'TD') as 'TH' | 'TD',
            font: { src: face, size: cellSize },
          };
        });
      }),
      defaultStyle: { border: 0.5, borderColor: '#cccccc', padding: 2 },
    });
    doc.moveDown(0.4);
    doc.font(fonts.regular).fontSize(fontSize);
  }
}

/** Minimal book shape the layout helpers need — kept structural so callers
 * can pass their own `Book` type without a cast fight. */
export interface PdfBookInfo {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published?: string;
}

/** Create the shared A4 document + register the bundled Unicode font family. */
export function createPdfDocument(book: PdfBookInfo): { doc: PDFKit.PDFDocument; fonts: PdfFontNames } {
  const bookTitle = book.display_title || book.title;
  const doc = new PDFDocument({
    size: 'A4',
    margins: PDF_MARGINS,
    bufferPages: false,
    info: {
      Title: bookTitle,
      Author: book.author || 'Anonymous',
      Creator: 'Source Library (sourcelibrary.org)',
      Producer: 'Source Library / PDFKit',
    },
  });
  const fonts = registerPdfFonts(doc);
  return { doc, fonts };
}

/** Title page shared by pdf-translation and pdf-facsimile. */
export function writePdfTitlePage(
  doc: PDFKit.PDFDocument,
  fonts: PdfFontNames,
  book: PdfBookInfo,
  opts: { subtitle: string; baseUrl: string; now: string },
): void {
  const bookTitle = book.display_title || book.title;

  doc.moveDown(5);
  doc.font(fonts.bold).fontSize(22).text(bookTitle, { align: 'center' });

  if (book.display_title && book.title !== book.display_title) {
    doc.moveDown(0.4);
    doc.font(fonts.italic).fontSize(13).text(book.title, { align: 'center' });
  }

  doc.moveDown(1);
  doc.font(fonts.regular).fontSize(13).text(book.author || 'Anonymous', { align: 'center' });

  if (book.published) {
    doc.moveDown(0.2);
    doc.fontSize(11).text(book.published, { align: 'center' });
  }

  doc.moveDown(2.5);
  doc.fontSize(11).text(opts.subtitle, { align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(9).fillColor('#666666').text(`${opts.baseUrl}/book/${book.id}`, { align: 'center' });
  doc.moveDown(0.2);
  doc.text(opts.now, { align: 'center' });
  doc.fillColor('#000000');
}

/** Small "Page N" heading before a page's content, matching the other
 * export formats' rust-colored page markers. `label` distinguishes the two
 * halves of a facsimile spread ("PAGE 12" scan / "PAGE 12 · ENGLISH" text). */
export function writePdfPageHeading(doc: PDFKit.PDFDocument, fonts: PdfFontNames, pageNumber: number, label?: string): void {
  doc.font(fonts.bold).fontSize(9).fillColor('#8b0000').text(`PAGE ${pageNumber}${label ? ` · ${label}` : ''}`);
  doc.fillColor('#000000');
  doc.moveDown(0.25);
}

/**
 * Colophon page shared by pdf-translation and pdf-facsimile — mirrors the
 * TXT generator's front-matter/colophon wording (Trithemian imprimatur
 * paragraph, CC BY-SA 4.0, "Produced by SourceLibrary.org in Amsterdam, 2026").
 */
export function writePdfColophon(
  doc: PDFKit.PDFDocument,
  fonts: PdfFontNames,
  book: PdfBookInfo,
  opts: { baseUrl: string; now: string; contentLabel: string; translatedCount: number; totalCount: number },
): void {
  const bookTitle = book.display_title || book.title;

  doc.font(fonts.bold).fontSize(16).text('About This Edition', { align: 'center' });
  doc.moveDown(1);
  doc.font(fonts.regular).fontSize(10);

  const lines: (string | null)[] = [
    `This ${opts.contentLabel} of "${bookTitle}" was produced by Source Library.`,
    '',
    `Author: ${book.author || 'Anonymous'}`,
    `Original language: ${book.language || 'Unknown'}`,
    book.published ? `Published: ${book.published}` : null,
    '',
    `Pages included: ${opts.translatedCount} of ${opts.totalCount}`,
    `Generated: ${opts.now}`,
    '',
    `Source: ${opts.baseUrl}/book/${book.id}`,
    'Downloaded: ' + opts.now,
    'License: CC BY-SA 4.0 (Creative Commons Attribution-ShareAlike)',
    'https://creativecommons.org/licenses/by-sa/4.0/',
    '',
    'This edition carries a Trithemian imprimatur — an invisible provenance',
    "mark in the tradition of the printer's device, asserting that this",
    'translation was produced by Source Library. It does not identify you',
    'or track your usage.',
    '',
    'Produced by SourceLibrary.org in Amsterdam, 2026.',
    'Source Library is a project of the Embassy of the Free Mind.',
    "Preserving humanity's wisdom for the digital age.",
  ];
  doc.text(lines.filter((l): l is string => l !== null).join('\n'), { lineGap: 4 });
}

// ─── Full-document generators ────────────────────────────────────────────
//
// Both PDF download formats live here (not in the route files) so the main
// route, the tenant twin, and the local QA harness
// (scripts/qa/render-book-pdf.ts) share ONE implementation. Image fetching
// stays with the caller, injected as an async-iterable streamer — each route
// keeps its own resolver/fetcher per the existing per-route pattern.

/** Minimal page shape the generators need. */
export interface PdfExportPage {
  page_number: number;
  translation?: { data?: string } | null;
}

/** Ordered, bounded-lookahead image streamer — see streamPageImagesOrdered()
 * in the download routes for the canonical implementation. */
export type PageImageStream<P extends PdfExportPage> = (
  pages: P[]
) => AsyncIterable<{ page: P; imageBuffer: Buffer | null }>;

/**
 * Budget for the facsimile image phase, in ms. `maxDuration` on the download
 * routes is 300s; we stop ADDING pages at 210s so there is room to finish the
 * page in hand, write the truncation notice and the colophon, and flush.
 *
 * A big book cannot be served whole in one request (a 4,198-page book would
 * need ~40 minutes of fetching), so the choice is between an opaque timeout and
 * an honest partial edition. Per CLAUDE.md "no silent caps": if coverage is
 * bounded, say what was dropped — here in the PDF itself, so the artifact
 * carries its own provenance rather than relying on a header nobody reads.
 */
export const FACSIMILE_IMAGE_BUDGET_MS = 210_000;

/**
 * Text-only English translation PDF: front matter, continuous flowing
 * translation text with a "PAGE N" heading before each page, then a colophon.
 * The returned PDFDocument is itself a Readable; content is appended
 * asynchronously after the caller starts piping it to the response, so we
 * never buffer the whole document before the first byte goes out.
 */
export function generatePdfTranslationStream<P extends PdfExportPage>(
  book: PdfBookInfo,
  pages: P[],
  opts: { baseUrl: string },
): PDFKit.PDFDocument {
  const now = new Date().toISOString().split('T')[0];
  const { doc, fonts } = createPdfDocument(book);

  const translatedPages = pages.filter(p => p.translation?.data);

  (async () => {
    writePdfTitlePage(doc, fonts, book, {
      subtitle: 'English Translation',
      baseUrl: opts.baseUrl,
      now,
    });

    doc.addPage();

    for (const page of translatedPages) {
      if (!page.translation?.data) continue;
      const text = cleanTranslationForPdf(page.translation.data, book.id);
      if (!text) continue;

      writePdfPageHeading(doc, fonts, page.page_number);
      writePdfBody(doc, fonts, text, { fontSize: 11, lineGap: 3 });
      doc.moveDown(0.8);
    }

    doc.addPage();
    writePdfColophon(doc, fonts, book, {
      baseUrl: opts.baseUrl,
      now,
      contentLabel: 'English translation',
      translatedCount: translatedPages.length,
      totalCount: pages.length,
    });

    doc.end();
  })().catch(err => {
    console.error('pdf-translation stream failed:', err);
    doc.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return doc;
}

/**
 * Facsimile PDF as FACING PAGES, like the site reader: each book page becomes
 * a full-page scan on a LEFT (verso) page and its English translation on the
 * facing RIGHT (recto) page. Reader feedback (2026-08-10) asked for exactly
 * the site's layout — "one page with the scan beside one page of translation."
 *
 * Mechanics:
 *  - The document catalog's /PageLayout is set to TwoPageRight, so PDF viewers
 *    that honor it (Acrobat, Preview's Two Pages mode) open with the title
 *    page alone on the right — like a book cover — and every following spread
 *    as scan-left / translation-right.
 *  - Physical page parity is maintained with blank filler pages: a long
 *    translation flows onto continuation pages, and without a filler the NEXT
 *    scan would drift onto a right-hand page, breaking every spread after it
 *    (the Loeb problem). Scans always land on even physical pages.
 *  - Streamed like generatePdfTranslationStream — pipe immediately.
 */
export function generatePdfFacsimileStream<P extends PdfExportPage>(
  book: PdfBookInfo,
  pages: P[],
  opts: {
    baseUrl: string;
    /** Does this page have a scan image the streamer can fetch? */
    hasImage: (p: P) => boolean;
    streamImages: PageImageStream<P>;
    imageBudgetMs?: number;
  },
): PDFKit.PDFDocument {
  const now = new Date().toISOString().split('T')[0];
  const budgetMs = opts.imageBudgetMs ?? FACSIMILE_IMAGE_BUDGET_MS;
  const { doc, fonts } = createPdfDocument(book);

  // Spread view: title page alone on the right, then scan-left/text-right
  // pairs. pdfkit has no public API for the catalog's /PageLayout; writing the
  // entry on the root dictionary is the accepted workaround and degrades to
  // nothing (viewer default) if a viewer ignores it.
  const catalog = (doc as unknown as { _root?: { data?: Record<string, unknown> } })._root;
  if (catalog?.data) catalog.data.PageLayout = 'TwoPageRight';

  // Pages with an image or a translation are worth a spread; pages with
  // neither carry nothing to show.
  const validPages = pages.filter(p => opts.hasImage(p) || p.translation?.data);

  (async () => {
    // Physical page counter — page 1 exists from the constructor; every
    // addPage() fires 'pageAdded'.
    let physical = 1;
    doc.on('pageAdded', () => { physical++; });

    writePdfTitlePage(doc, fonts, book, {
      subtitle: 'Facsimile Edition — page scans facing their English translation',
      baseUrl: opts.baseUrl,
      now,
    });

    console.log(`Streaming ${validPages.length} images for pdf-facsimile...`);
    const startedAt = Date.now();
    let written = 0;
    let translated = 0;
    let truncated = false;

    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const usableHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
    // Room left for the scan under its "PAGE N" heading.
    const scanHeight = usableHeight - 24;

    for await (const { page, imageBuffer } of opts.streamImages(validPages)) {
      if (Date.now() - startedAt > budgetMs) {
        truncated = true;
        break;
      }
      written++;
      if (page.translation?.data) translated++;

      // The scan must sit on an EVEN physical page (left of the spread under
      // TwoPageRight). If the next page would be odd — the previous
      // translation ran long — insert one blank filler page.
      if ((physical + 1) % 2 !== 0) doc.addPage();

      doc.addPage();
      writePdfPageHeading(doc, fonts, page.page_number);
      if (imageBuffer) {
        try {
          doc.image(imageBuffer, { fit: [usableWidth, scanHeight], align: 'center' });
        } catch (e) {
          console.error(`pdf-facsimile: failed to embed image for page ${page.page_number}:`, e);
          doc.font(fonts.italic).fontSize(10).fillColor('#999999').text('[Image unavailable]');
          doc.fillColor('#000000');
        }
      } else {
        doc.font(fonts.italic).fontSize(10).fillColor('#999999').text('[Image unavailable]');
        doc.fillColor('#000000');
      }

      doc.addPage();
      writePdfPageHeading(doc, fonts, page.page_number, 'ENGLISH');
      const text = page.translation?.data
        ? cleanTranslationForPdf(page.translation.data, book.id)
        : '';
      if (text) {
        writePdfBody(doc, fonts, text, { fontSize: 10.5, lineGap: 3 });
      } else {
        doc.font(fonts.italic).fontSize(10).fillColor('#999999')
          .text('No translation available for this page.');
        doc.fillColor('#000000');
      }
    }

    if (truncated) {
      const firstMissing = validPages[written]?.page_number;
      doc.addPage();
      doc.font(fonts.bold).fontSize(14).text('This edition is incomplete', { align: 'center' });
      doc.moveDown(1);
      doc.font(fonts.regular).fontSize(11).text(
        [
          `This facsimile stops at page ${validPages[written - 1]?.page_number ?? written} of `
          + `${validPages.length}. It was not truncated for editorial reasons: a single request `
          + 'cannot fetch and lay out every page scan of a book this large within the time '
          + 'available, so generation stopped rather than failing outright.',
          '',
          firstMissing !== undefined
            ? `Pages from ${firstMissing} onward are not included here. They are all readable `
              + `at ${opts.baseUrl}/book/${book.id}, and the text-only PDF and EPUB editions cover `
              + 'the whole book.'
            : '',
          '',
          'If you need the complete facsimile as a single file, please get in touch — we would '
          + 'rather generate it for you offline than hand you a partial edition without saying so.',
        ].filter(Boolean).join('\n'),
        { lineGap: 3 },
      );
      console.warn(
        `pdf-facsimile truncated: ${written}/${validPages.length} pages for book ${book.id} `
        + `after ${Date.now() - startedAt}ms`,
      );
    }

    doc.addPage();
    writePdfColophon(doc, fonts, book, {
      baseUrl: opts.baseUrl,
      now,
      contentLabel: truncated ? 'partial facsimile edition' : 'facsimile edition',
      translatedCount: translated,
      totalCount: pages.length,
    });

    doc.end();
  })().catch(err => {
    console.error('pdf-facsimile stream failed:', err);
    doc.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return doc;
}
