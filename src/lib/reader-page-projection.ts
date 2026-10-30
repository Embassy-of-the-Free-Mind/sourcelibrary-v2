/**
 * The `pages` projection for the reader route (#5184).
 *
 * PRIOR ART: src/app/book/[id]/page/[pageId]/page-data.ts (the metadata
 * loader's narrow inclusion list — reads only text + seo flag, far too thin
 * for the reader) and src/lib/og-page-card.tsx OG_PAGE_PROJECTION (same
 * shape, OG card only). Neither covers what Reader2C / PageEditorClient read,
 * so this is the reader's own list.
 *
 * Replaces `{ projection: { detected_images: 0 } }` — an EXCLUSION that
 * shipped every other field of the doc into the RSC flight payload of the
 * site's highest-volume route. The list below is the union of every field the
 * two render trees read (traced 2026-09-26 through Reader2C, ReaderV2Bits,
 * useReaderV2, PaneEmptyState, PairedEdition, ReaderSpanishToggle,
 * ReaderWebMCP, PageEditorClient, TranslationEditor, PageMetadataPanel,
 * DeepZoomInline, and the lib helpers page-image-url, free-preview,
 * provenance, text-provenance, page-translations, word-alignment):
 *
 *  - identity / nav: id, book_id, page_number, page_type, split_from,
 *    seo_indexable (JSON-LD gate + free-preview), tenantId.
 *  - scan resolution (page-image-url.ts): photo, photo_original,
 *    archived_photo (its `failed:` sentinel is load-bearing), cropped_photo,
 *    enhanced_photo, display_photo, image_thumb, thumbnail_blob (a URL, not a
 *    blob), thumbnail, split_from_spread, crop. These are NOT independently
 *    droppable: `variantMatchesSource()` judges each stored variant against
 *    the resolved source.
 *  - layout: columns, display_brightness, image_width, image_height, deepzoom.
 *  - text: ocr and translation WHOLE (PageMetadataPanel walks
 *    `ocr.engine`/`ocr.verdict` as objects and reads a dozen provenance
 *    sub-fields), translations (whole map — availableTranslations() iterates
 *    every key), translation_es, translation_withheld, summary, modernized,
 *    transliteration (a miss on `.data` costs a paid Gemini call per view).
 *  - metadata panel: read_count, edit_count, created_at, updated_at.
 *
 * Deliberately left out (verified unread in both trees): _id,
 * detected_images, word_alignment (the alignment API runs its own query),
 * archive_metadata, translation_summary, translation_keywords,
 * semantic_alignment, script_type, split_detection/side/position,
 * fullres_master, image_metadata, seo_url, and the etcsl/iiif_info/
 * scan_quality/needs_reocr sprawl a key census turned up.
 *
 * `/api/pages/[id]` and `/api/pages/batch` (the client-side page turn and
 * prefetch) still use the old exclusion, so a page reached by navigation
 * carries a superset of this list. That is safe in this direction — nothing
 * here is missing there — but a follow-up should point them at this constant
 * so the two paths cannot drift (#4603).
 */
export const READER_PAGE_PROJECTION = {
  _id: 0,
  id: 1, book_id: 1, page_number: 1, page_type: 1, split_from: 1, seo_indexable: 1, tenantId: 1,
  // An archived split parent's leaves — the embed/room redirect reads it (#5842).
  split_into: 1,
  // A hidden repeat capture names its kept page; the reader redirects there (#5056).
  repeat_of: 1,
  photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1,
  display_photo: 1, image_thumb: 1, thumbnail_blob: 1, thumbnail: 1,
  split_from_spread: 1, crop: 1,
  // Where the page sits inside the scan, shown cropped to it (#5876).
  page_frame: 1,
  columns: 1, display_brightness: 1, image_width: 1, image_height: 1, deepzoom: 1,
  ocr: 1, translation: 1, translations: 1, translation_es: 1, translation_withheld: 1,
  summary: 1, modernized: 1, transliteration: 1,
  read_count: 1, edit_count: 1, created_at: 1, updated_at: 1,
} as const;

/**
 * #5942: the stored text layer (`translation.text`, `translation.text_from`) stays on the server.
 * The reader renders the raw `data` and serialises the page whole into its RSC payload, so a
 * page the notes-layer backfill has written would otherwise ship its translation twice (~2 KB per
 * page), and a page whose `data` was later withheld by a dotted `$unset` would ship the withheld
 * words in `text`. A surface that wants the clean words reads them server-side through
 * getTranslationText (src/lib/translation-text.ts) — never from this payload.
 *
 * Exclusion projection for `/api/pages/[id]`, `/api/pages/batch` and their tenant twins.
 */
export const PAGE_API_PROJECTION = Object.freeze({ detected_images: 0, 'translation.text': 0, 'translation.text_from': 0 });

/**
 * The same for the reader route, whose projection is an inclusion list (`translation: 1` whole —
 * MongoDB cannot exclude a sub-field there): drop the two fields from the fetched page. Key order
 * is kept, so a backfilled page serialises exactly as a page that never had them.
 */
export function withoutTextLayer<T>(page: T): T {
  const t = (page as { translation?: unknown } | null)?.translation;
  if (!t || typeof t !== 'object' || !('text' in t || 'text_from' in t)) return page;
  const { text: _text, text_from: _from, ...rest } = t as Record<string, unknown>;
  return { ...(page as object), translation: rest } as T;
}
