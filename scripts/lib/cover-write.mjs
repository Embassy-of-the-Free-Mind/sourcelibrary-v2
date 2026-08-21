/**
 * Node-side mirror of `src/lib/cover-fields.ts`.
 *
 * Used by:
 *   - pipeline-orchestrator.mjs (Phase 3 + Phase 8.9, after migration)
 *   - smart-cover-selection.mjs
 *   - batch-cover-selection.mjs (vision)
 *   - one-shot scripts in scripts/_archived/2026-05-cover-fixes/
 *
 * Produces the same update shape as `buildCoverUpdate()` in TS so that
 * the BPH embed API reads (image_thumb || image_display || …) and the
 * `getBookThumbnailUrl()` reader path always agree, regardless of which
 * writer ran.
 *
 * Keep this in lock-step with src/lib/cover-fields.ts. The unit tests
 * in tests/unit/cover-fields.test.ts pin the TS shape; if you change
 * field semantics there, mirror it here.
 */

// Scanner's-hand screen — shared with the cover scorer (same file-pair rule).
import { HAND_IN_FRAME_RE } from './cover-scoring.mjs';

/** The four canonical write keys + provenance. */
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
];

/**
 * Resolve the best image URL for a page, suitable for use as a cover.
 * Mirrors `pageImageUrl()` from src/lib/types/page.ts.
 *
 * Returns DIRECT URLs only — never `/api/image?url=` wrappers.
 */
export function resolvePageCoverUrl(page) {
  // Split pages: use `photo` directly (the cropped half).
  // The legacy fallback would point at the full spread via archived_photo.
  if (page.split_from_spread || page.crop) {
    const url = page.photo;
    return url && url.startsWith('http') ? url : null;
  }

  const url = page.enhanced_photo
    || page.cropped_photo
    || page.archived_photo
    || page.photo_original
    || page.photo
    || '';
  return url && url.startsWith('http') ? url : null;
}

/**
 * Build a cover-update payload from a chosen page.
 *
 * @param {Object} page                Page document (must include the URL fields)
 * @param {Object} opts
 * @param {string} opts.source         e.g. 'manual' | 'smart_ocr' | 'vision' | 'pipeline-auto'
 * @param {string} [opts.method]       Provenance method label (e.g. 'cover-picker-ui')
 * @param {number} [opts.confidence]   0..1 confidence
 * @param {string} [opts.detail]       Free-form provenance detail
 * @param {string} [opts.actor]        'pipeline' | 'admin' | 'script'
 * @returns {Object|null}              Update doc to pass to `$set`, or null if page has no usable image
 */
export function buildCoverUpdate(page, opts) {
  const url = resolvePageCoverUrl(page);
  if (!url) return null;

  const thumbUrl = page.image_thumb || page.thumbnail_blob || url;

  const update = {
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
        source: opts.actor || 'script',
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
 * Mirror of `isRenderableCoverUrl()` in src/lib/cover-fields.ts.
 *
 * Hosts whose images the browser will actually load. A raw source URL
 * (archive.org, gallica, …) resolves fine with curl but the site CSP blocks it,
 * so it must never be written as a cover — in the catalogue there is no
 * page-scan fallback to cover for it.
 */
export const RENDERABLE_COVER_HOST_RE =
  /(images\.sourcelibrary\.org|public\.blob\.vercel-storage\.com|upload\.wikimedia\.org)/;

export function isRenderableCoverUrl(url) {
  return RENDERABLE_COVER_HOST_RE.test(String(url || ''));
}

/** Mirror of `selectFallbackCoverPage()` in src/lib/cover-fields.ts. */
const JUNK_COVER_PAGE_TYPES = new Set([
  'blank', 'digitizer-insert', 'archived-spread', 'scanner_metadata',
  'scanner-metadata', 'color-card', 'colorcard', 'color_card', 'target',
]);

/** Mirror of `isJunkRepresentativePage()` in src/lib/cover-fields.ts.
 *  DIGITIZER_RE is deliberately narrow — a bare /digitized by/ matches the
 *  `Digitized by Google` watermark carried on every leaf of a Google scan and
 *  would disqualify real title pages. Keep in lock-step with the TS original. */
const DIGITIZER_RE = /digital insertion|funding from|archive\.org\/details|this is a digital copy of a book/i;
const OWNERSHIP_RE = /\bex[\s-]?libris\b|\bbook\s?plate\b|\bshelf\s?mark\b|\bcall number\b|\bbarcode\b|\baccession (?:number|no\b|label|stamp)|\bproperty of\b|\bpresented by\b|library (?:stamp|label|bookplate|identification|shelfmark)|\bcolou?r\s?(?:card|chart|target|checker)\b|\bcalibration\b/i;
const BINDING_RE = /\b(?:front|back|exterior) cover\b|\bbook cover\b|\bcover or binding\b|\bbinding\/cover\b|\bleather[\s-]?bound\b|\b(?:leather|vellum|parchment|cloth|marbled|pasteboard|morocco) (?:binding|cover|boards?)\b|\bblind[\s-]tooled\b|\bgold[\s-]tooled\b|\bspine label\b/i;

export function isJunkRepresentativePage(page) {
  if (JUNK_COVER_PAGE_TYPES.has(String(page.page_type || ''))) return true;
  const head = String(page.ocr_head || '');
  if (!head) return false;
  return DIGITIZER_RE.test(head) || OWNERSHIP_RE.test(head) || BINDING_RE.test(head)
    || HAND_IN_FRAME_RE.test(head);
}

export function selectFallbackCoverPage(pages) {
  const usable = pages.filter(p => !isJunkRepresentativePage(p));
  return usable.find(p => p.page_type === 'title-page')
    || usable.find(p => p.page_type === 'frontispiece')
    || usable[0]
    || pages[0];
}
