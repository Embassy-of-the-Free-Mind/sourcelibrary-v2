/**
 * JS twin of src/lib/page-image-url.ts for pipeline/worker scripts (issue #1727).
 *
 * Scripts choose the OCR / image-extraction SOURCE — they want the original
 * readable image, not a display resize. So this twin exports `getPageSource`
 * (the split-aware source-identity normalizer) and the two small predicates it
 * needs. Keep it in lockstep with `getPageSource` in the TS module.
 *
 * Why a separate copy: scripts run as plain .mjs and can't import the `@/`
 * TS-path-aliased lib. The logic is small and stable; the unit tests assert the
 * two implementations agree.
 */

/** A usable HTTP(S) image URL (not a "failed:HTTP 404" marker). */
export function isUsableImageUrl(url) {
  return !!url && (url.startsWith('http://') || url.startsWith('https://'));
}

/** Archiving was attempted and failed — the source URLs are known dead. */
export function isArchiveFailed(photo) {
  return typeof photo === 'string' && photo.startsWith('failed:');
}

/**
 * The original-resolution source image for a page — the file to OCR, download,
 * or resize from. Split-aware:
 *   1. cropped_photo        — old-era split: materialized cropped half
 *   2. split_from_spread photo — new-era split: `photo` rewritten to the sp… half
 *   3. archiving failed → null
 *   4. enhanced_photo — enhanced copy, preferred when present (after split handling)
 *   5. archived_photo → photo_original → photo
 */
export function getPageSource(page) {
  if (isUsableImageUrl(page.cropped_photo)) return page.cropped_photo;
  if (page.split_from_spread && isUsableImageUrl(page.photo)) return page.photo;
  if (isArchiveFailed(page.archived_photo)) return null;
  if (isUsableImageUrl(page.enhanced_photo)) return page.enhanced_photo;
  if (isUsableImageUrl(page.archived_photo)) return page.archived_photo;
  if (isUsableImageUrl(page.photo_original)) return page.photo_original;
  if (isUsableImageUrl(page.photo)) return page.photo;
  return null;
}
