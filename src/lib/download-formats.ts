/**
 * Single source of truth for download format tier membership (#3290).
 *
 * Three-tier model:
 *  1. Free with sign-in — text formats (translation/OCR/EPUB/PDF-translation).
 *     Subject only to the daily download cap (src/lib/download-cap.ts).
 *  2. Paid ($5/book or membership) — image-bearing facsimiles, the parallel-
 *     text edition, and the scholarly/bilingual apparatus editions. Gated by
 *     canDownload() (src/lib/purchases.ts).
 *  3. License-driven (unchanged) — NC-free scans stay free with sign-in;
 *     image-restricted books keep image formats blocked (403). See
 *     classifyImageAccess() in src/lib/purchases.ts.
 *
 * Imported by BOTH download routes (global + tenant twin) AND
 * DownloadButton.tsx — this module must stay safe to import from a client
 * component: no `mongodb`, no `next/server`, no Node built-ins.
 *
 * A pin test (tests/unit/download-format-tiers.test.ts) locks the exact
 * membership of each tier so an accidental edit here fails loudly instead of
 * silently moving a format between free and paid.
 */
import type { BookDownloadFormats } from '@/lib/api-client/types/books';

/** Text formats: free for any signed-in user, capped at 20 distinct books/24h. */
export const FREE_TEXT_FORMATS = [
  'translation',
  'ocr',
  'both',
  'epub-translation',
  'epub-ocr',
  'epub-both',
  'pdf-translation',
] as const satisfies readonly BookDownloadFormats[];

/** Premium formats: require membership or a per-book purchase. */
export const PREMIUM_FORMATS = [
  'pdf-facsimile',
  'epub-parallel',
  'epub-parallel-fxl',
  'epub-scholarly',
  'epub-bilingual',
  'epub-facsimile',
  'epub-images',
  'images-zip',
] as const satisfies readonly BookDownloadFormats[];

export const ALL_DOWNLOAD_FORMATS = [
  ...FREE_TEXT_FORMATS,
  ...PREMIUM_FORMATS,
] as const satisfies readonly BookDownloadFormats[];

type FreeTextFormat = (typeof FREE_TEXT_FORMATS)[number];
type PremiumFormat = (typeof PREMIUM_FORMATS)[number];

const PREMIUM_SET = new Set<string>(PREMIUM_FORMATS);
const ALL_FORMATS_SET = new Set<string>(ALL_DOWNLOAD_FORMATS);

// Image-bearing formats: fetch + embed page scans, so they're subject to
// classifyImageAccess() (blocked/nc-free license classification) in addition
// to the paid-format gate. Every one of these is also a PREMIUM_FORMATS
// member — image formats are always premium, but not every premium format is
// an image format (epub-parallel/epub-scholarly/epub-bilingual are text-only
// but still paid). Semantics kept identical to DownloadButton.tsx's
// pre-#3290 `isImageFormat`.
const IMAGE_FORMAT_SET = new Set<string>([
  'pdf-facsimile',
  'epub-facsimile',
  'epub-images',
  'images-zip',
]);

/** True for any format recognized by the download pipeline (free or premium). */
export function isValidDownloadFormat(format: string): format is BookDownloadFormats {
  return ALL_FORMATS_SET.has(format);
}

/** True for formats that require membership or a per-book purchase. */
export function isPremiumFormat(format: string): format is PremiumFormat {
  return PREMIUM_SET.has(format);
}

/** True for formats that embed page scans and are subject to image-license classification. */
export function isImageFormat(format: string): boolean {
  return IMAGE_FORMAT_SET.has(format);
}

export type { FreeTextFormat, PremiumFormat };
