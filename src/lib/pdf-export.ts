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
 * Flatten the inline annotation tags translation text carries, for a plain-
 * flowing PDF text run. Conceptually mirrors `markdownToHtml()`'s tag
 * handling: gloss/term/unclear/insert keep their content; note/margin keep
 * their content bracketed (the plain-text convention used elsewhere in these
 * exports); page-physical metadata tags are dropped entirely.
 *
 * Call this AFTER stripEditorialWrappers() + markForExport() — see
 * `cleanTranslationForPdf` below, which is the entry point every caller
 * should use.
 */
function flattenTagsForPdf(text: string): string {
  let out = text;

  // Markdown image syntax + bare URLs don't render as inline images/links in
  // flowing PDF text.
  out = out.replace(/!\[.*?\]\(.*?\)/g, '');
  out = out.replace(/https?:\/\/[^\s)]+/g, '');

  // Inline glosses — keep content plain.
  out = out.replace(/<gloss>([\s\S]*?)<\/gloss>/gi, '$1');
  out = out.replace(/<term>([\s\S]*?)<\/term>/gi, '$1');
  out = out.replace(/<unclear>([\s\S]*?)<\/unclear>/gi, '$1?');
  out = out.replace(/<insert>([\s\S]*?)<\/insert>/gi, '$1');

  // Marginal annotations — keep content, bracket it.
  out = out.replace(/<note>([\s\S]*?)<\/note>/gi, '[$1]');
  out = out.replace(/<margin>([\s\S]*?)<\/margin>/gi, '[$1]');

  out = out.replace(/<column-break\s*\/?>/gi, '\n\n');
  out = out.replace(/<page-break\s*\/?>/gi, '');

  // Page-physical metadata tags — drop entirely (content and all).
  out = out.replace(PDF_METADATA_TAG_RE, '');

  // Safety net for any unrecognized tag: strip the markup, keep the content —
  // real page text should never be silently eaten by an unhandled tag.
  out = out.replace(/<\/?[a-z][a-z0-9-]*\s*\/?>/gi, '');

  return out.trim();
}

/**
 * Clean a page's raw translation text for PDF rendering:
 *   1. stripEditorialWrappers() — removes AI page-description wrapper blocks
 *      (never verbatim source, see CLAUDE.md "Quote & snippet integrity") and
 *      flattens markdown markup (headers/bold/italic/tables/->centered<-).
 *   2. markForExport() — invisible zero-width provenance mark (same as every
 *      other download format).
 *   3. flattenTagsForPdf() — inline annotation tags → plain text.
 */
export function cleanTranslationForPdf(raw: string, bookId: string): string {
  if (!raw) return '';
  // keepTables — a downloaded edition is the whole text, not a snippet. The
  // default flattening keeps every cell value but discards the column it
  // belonged to; `writePdfBody()` below lays the surviving markup out as a real
  // PDF table instead. (40% of pages in a manuscript like Kitab al-Bulhan are
  // calendar/abjad tables, so this is not an edge case.)
  const stripped = stripEditorialWrappers(raw, { keepTables: true });
  const marked = markForExport(stripped, bookId);
  return flattenTagsForPdf(marked);
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

/**
 * Write a string that may mix Latin and Arabic, switching face per run.
 *
 * Two facts force this, both verified by rendering (2026-08-03):
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
 */
function writeScriptAwareText(
  doc: PDFKit.PDFDocument,
  fonts: PdfFontNames,
  text: string,
  opts: { fontSize: number; lineGap?: number },
): void {
  const { fontSize, lineGap = 3 } = opts;
  // No Arabic, or no Arabic face bundled: one plain call. When the face is
  // missing we deliberately keep the .notdef boxes rather than dropping the
  // text — a visible gap is honest, silently-deleted source is not.
  if (!fonts.arabic || !ARABIC_RE.test(text)) {
    doc.font(fonts.regular).fontSize(fontSize).text(text, { lineGap });
    return;
  }
  // Continuation is scoped to ONE LINE. `continued: true` resumes at the
  // current x, and an embedded "\n" inside a continued run does not reset it —
  // so a single chain over multi-line text indents every line after the first
  // to wherever the previous run happened to end. (Caught by rendering the full
  // book: page 195 showed "hoping? for God's mercy" starting mid-measure.)
  // Splitting per line keeps each line starting at the margin, matching the
  // plain `doc.text(text)` path above.
  const lines = text.split('\n');
  lines.forEach(line => {
    if (!line) {
      doc.font(fonts.regular).fontSize(fontSize).text(' ', { lineGap });
      return;
    }
    const runs = splitScriptRuns(line);
    runs.forEach((run, i) => {
      doc
        .font(run.arabic ? fonts.arabic! : fonts.regular)
        .fontSize(fontSize)
        .text(run.text, {
          lineGap,
          continued: i < runs.length - 1,
          ...(run.arabic ? { features: ['rtla'] } : {}),
        });
    });
  });
  doc.font(fonts.regular).fontSize(fontSize);
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
      writeScriptAwareText(doc, fonts, block.text, { fontSize, lineGap });
      continue;
    }
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
 * export formats' rust-colored page markers. */
export function writePdfPageHeading(doc: PDFKit.PDFDocument, fonts: PdfFontNames, pageNumber: number): void {
  doc.font(fonts.bold).fontSize(9).fillColor('#8b0000').text(`PAGE ${pageNumber}`);
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
