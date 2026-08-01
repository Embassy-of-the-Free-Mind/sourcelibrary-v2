/**
 * Cover-write contract — single source of truth for setting a book's cover.
 *
 * The `books` collection stores cover URLs in four fields:
 *   - image_display   — canonical full-resolution URL (preferred reader)
 *   - image_thumb     — canonical thumbnail URL (preferred reader)
 *   - thumbnail       — legacy full-res URL (kept until backfill complete)
 *   - thumbnail_blob  — legacy thumbnail URL (kept until backfill complete)
 *
 * Background: the R2-only migration (PR #1588) introduced the canonical
 * fields and switched `getBookThumbnailUrl()` to prefer them. Several
 * writers were updated to dual-write but the PATCH allow-list and a
 * couple of other writers were missed, causing covers to update only
 * partially — the page rendered the unchanged canonical field and the
 * user saw "nothing happened." Cf.
 * `.claude/handoffs/2026-05-05-bph-cover-pipeline-postmortem.md`.
 *
 * Rule: every writer (UI, API, pipeline, script) builds its cover-update
 * payload through `buildCoverUpdate()` so all four fields move together.
 *
 * The Node-side mirror lives at `scripts/lib/cover-write.mjs` — keep them
 * in lock-step. Tests in `src/lib/__tests__/cover-fields.test.ts` assert
 * the shape.
 */

import type { Page } from './types';
import { pageImageUrl } from './types/page';

/**
 * Provenance label for the cover-selection method.
 * Free-form to allow new methods (e.g. dated rescore tags), but the four
 * "canonical" sources cover most calls.
 */
export type ThumbnailSource =
  | 'manual'           // user clicked a page in the cover picker
  | 'smart_ocr'        // OCR-based scoring (scripts/lib/cover-scoring.mjs)
  | 'vision'           // Gemini Vision pass over candidate pages
  | 'pipeline-auto'    // automatic pick during initial ingest
  | (string & {});     // ad-hoc tags like 'smart_ocr_resync_2026-05-05'

/**
 * Field-level provenance recorded alongside the cover update so we can
 * trace why a particular page was chosen — useful when re-running with
 * a smarter algorithm on top of older picks.
 */
export interface CoverProvenance {
  source: 'pipeline' | 'admin' | 'script';
  method: string;         // e.g. 'smart-ocr-cover-rescore', 'cover-picker-ui'
  confidence: number;     // 0..1
  date: Date;
  detail?: string;        // free-form (e.g. "frontispiece with engraving (score: 105)")
}

export interface CoverUpdate {
  // Canonical fields (preferred reader path in `getBookThumbnailUrl`)
  image_display: string;
  image_thumb: string;

  // Legacy mirrors (BPH embed API and a few CMS pages still read these)
  thumbnail: string;
  thumbnail_blob: string;

  // Provenance
  thumbnail_source: ThumbnailSource;
  cover_page?: number;
  cover_selected_at?: Date;
  field_provenance?: { thumbnail: CoverProvenance };
}

/**
 * Resolve the best image URL for a page, suitable for use as a cover.
 * Wraps `pageImageUrl` and returns `null` on misses so callers can decide
 * what to do with pages that have no usable image.
 *
 * Returns DIRECT URLs only — never `/api/image?url=` wrappers, which
 * crash Next.js Image during SSR.
 */
export function resolvePageCoverUrl(page: Partial<Page>): string | null {
  const url = pageImageUrl(page);
  return url && url.startsWith('http') ? url : null;
}

/**
 * Build a cover-update payload from a chosen page.
 *
 * Today the same URL is written to both display and thumb slots — there
 * isn't a separate small-thumbnail asset for most pages. When we add one
 * (e.g. R2 `-thumb.jpg` variants), update this helper and every reader
 * benefits.
 */
export function buildCoverUpdate(
  page: Partial<Page> & { page_number?: number },
  opts: {
    source: ThumbnailSource;
    method?: string;
    confidence?: number;
    detail?: string;
    actor?: 'pipeline' | 'admin' | 'script';
  },
): CoverUpdate | null {
  const url = resolvePageCoverUrl(page);
  if (!url) return null;

  // Prefer the page's pre-generated thumbnail (R2 small variant) when
  // present; otherwise fall back to the same URL as `display`.
  const thumbUrl = (page as Partial<Page>).image_thumb
    || (page as Partial<Page>).thumbnail_blob
    || url;

  const update: CoverUpdate = {
    image_display: url,
    image_thumb: thumbUrl,
    thumbnail: url,
    thumbnail_blob: thumbUrl,
    thumbnail_source: opts.source,
  };

  if (page.page_number !== undefined) {
    update.cover_page = page.page_number;
    update.cover_selected_at = new Date();
  }

  if (opts.method) {
    update.field_provenance = {
      thumbnail: {
        source: opts.actor || 'admin',
        method: opts.method,
        confidence: opts.confidence ?? 1,
        date: new Date(),
        detail: opts.detail,
      },
    };
  }

  return update;
}

/**
 * Hosts whose images the browser will actually load: our own R2, Vercel blob,
 * and the Wikimedia CDN. A freshly-imported book often carries a raw source URL
 * (archive.org, gallica, …) in `thumbnail` — it resolves fine with curl but the
 * site CSP `img-src` blocks it, so the card renders empty. Anything outside this
 * set must be treated as "no cover" by readers, and must never be *written* as
 * one: persisting a blocked URL only launders the problem into the catalogue,
 * where there is no page-scan fallback to cover for it.
 */
export const RENDERABLE_COVER_HOST_RE =
  /(images\.sourcelibrary\.org|public\.blob\.vercel-storage\.com|upload\.wikimedia\.org)/;

export function isRenderableCoverUrl(url?: string | null): boolean {
  return RENDERABLE_COVER_HOST_RE.test(String(url || ''));
}

/**
 * The page a book should fall back to when it has no usable stored cover:
 * the printed title page, else a frontispiece, else the first non-blank leaf,
 * else whatever came first. Junk leaves (scanner colour cards, calibration
 * targets, digitizer inserts) are skipped — they are what makes an un-curated
 * book show a grey colour chart as its cover. Note that `cover` / `frontcover`
 * leaves are deliberately NOT skipped here: they are junk for the page-page's
 * "representative interior page" pick, but they are exactly what we want for a
 * cover.
 *
 * Shared deliberately: the book page renders from this and
 * `/api/books/[id]/ensure-cover` persists from it, so the cover a reader sees
 * and the cover the catalogue stores are the same page by construction rather
 * than by two lists that agree today. Callers pass pages already sorted by
 * `page_number`.
 */
const JUNK_COVER_PAGE_TYPES = new Set([
  'blank', 'digitizer-insert', 'archived-spread', 'scanner_metadata',
  'scanner-metadata', 'color-card', 'colorcard', 'color_card', 'target',
]);

export function selectFallbackCoverPage<T extends { page_type?: string | null }>(
  pages: ReadonlyArray<T>,
): T | undefined {
  const usable = pages.filter(p => !JUNK_COVER_PAGE_TYPES.has(String(p.page_type || '')));
  return pages.find(p => p.page_type === 'title-page')
    || pages.find(p => p.page_type === 'frontispiece')
    || usable[0]
    || pages[0];
}

/**
 * The four canonical write keys, exposed as a constant so the PATCH
 * allow-list can extend its base set without drifting from this module.
 *
 * Use as: `[...COVER_WRITE_FIELDS, 'title', 'author', ...]` in
 * server-side allow-lists.
 */
export const COVER_WRITE_FIELDS = [
  'image_display',
  'image_thumb',
  'image_full',
  'image_source_url',
  'thumbnail',
  'thumbnail_blob',
  'thumbnail_source',
  'cover_page',
  'cover_selected_at',
] as const;
