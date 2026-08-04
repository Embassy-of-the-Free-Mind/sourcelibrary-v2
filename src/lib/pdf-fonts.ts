/**
 * Unicode-safe font loading for pdfkit-generated PDFs.
 *
 * pdfkit's 14 built-in fonts (Helvetica, Times-Roman, …) are WinAnsi-only —
 * they have no glyphs for combining diacritics, Greek, Cyrillic, or most of
 * Latin Extended. Translation text routinely contains all of these (accented
 * transliterations, quoted Greek terms, etc), so any PDF export that renders
 * translation text needs a real embedded TTF.
 *
 * We bundle Noto Serif (Regular/Bold/Italic, OFL-1.1 licensed) under
 * src/assets/fonts/ rather than downloading it at request time:
 *  - it's read via a fully static `path.join(process.cwd(), 'src/assets/fonts/…')`
 *    path, which Vercel's build-time file tracer (@vercel/nft) picks up as a
 *    function dependency automatically (the same pattern Vercel's own docs use
 *    for bundling a local data file with a serverless function) — no network
 *    call needed per request, unlike the /tmp-cached Google Fonts download
 *    this repo already does for the EPUB cover font (`ensureCoverFont`).
 *  - `next.config.ts`'s `outputFileTracingIncludes` pins the same files as a
 *    defensive belt-and-suspenders in case static analysis ever misses it.
 *
 * Verified (2026-07-20): Noto Serif's zero-width-character glyphs (U+200B/
 * 200C/200D/FEFF — the exact codepoints `markForExport()`'s provenance mark
 * uses) all have advanceWidth 0, so the invisible mark stays invisible when
 * rendered through this font, not just in HTML/plaintext.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

export interface PdfFontSet {
  regular: Buffer | null;
  bold: Buffer | null;
  italic: Buffer | null;
  /** Noto Naskh Arabic — Noto Serif has NO Arabic glyphs (see registerPdfFonts). */
  arabic: Buffer | null;
}

let cached: PdfFontSet | null = null;

function readBundledFont(filename: string): Buffer | null {
  try {
    return readFileSync(join(process.cwd(), 'src', 'assets', 'fonts', filename));
  } catch (e) {
    console.error(`[pdf-fonts] failed to read bundled font ${filename}:`, e);
    return null;
  }
}

/** Load (and cache across warm serverless invocations) the bundled Noto Serif family. */
export function loadPdfFonts(): PdfFontSet {
  if (cached) return cached;
  cached = {
    regular: readBundledFont('NotoSerif-Regular.ttf'),
    bold: readBundledFont('NotoSerif-Bold.ttf'),
    italic: readBundledFont('NotoSerif-Italic.ttf'),
    arabic: readBundledFont('NotoNaskhArabic-Regular.ttf'),
  };
  return cached;
}

/** Font name triple to use with `doc.font(name)` after registration. */
export interface PdfFontNames {
  regular: string;
  bold: string;
  italic: string;
  /** null when no Arabic face is bundled — never silently a Latin face. */
  arabic: string | null;
}

/**
 * Register the bundled Noto Serif family on a pdfkit document and return the
 * font names to use with `.font(name)`. Falls back to pdfkit's built-in
 * Times-Roman family per-face if a bundled TTF failed to read at runtime —
 * degrades to WinAnsi-only rather than failing the whole export.
 */
export function registerPdfFonts(doc: PDFKit.PDFDocument): PdfFontNames {
  const fonts = loadPdfFonts();
  if (fonts.regular) doc.registerFont('SL-Body', fonts.regular);
  if (fonts.bold) doc.registerFont('SL-Body-Bold', fonts.bold);
  if (fonts.italic) doc.registerFont('SL-Body-Italic', fonts.italic);
  if (fonts.arabic) doc.registerFont('SL-Arabic', fonts.arabic);
  return {
    regular: fonts.regular ? 'SL-Body' : 'Times-Roman',
    bold: fonts.bold ? 'SL-Body-Bold' : 'Times-Bold',
    italic: fonts.italic ? 'SL-Body-Italic' : 'Times-Italic',
    // null (not a Latin fallback) when the TTF is missing — the caller must be
    // able to tell "no Arabic face available" from "here is a face", because
    // rendering Arabic through Noto Serif produces .notdef boxes, not text.
    arabic: fonts.arabic ? 'SL-Arabic' : null,
  };
}
