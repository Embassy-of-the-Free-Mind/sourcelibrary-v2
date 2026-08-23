/**
 * Whitelisted document constructors for `books` and `pages` inserts.
 *
 * WHY (issue #3969): the ~36 direct-import scripts each hand-roll their insert
 * literals, which is how one bug (`tenant_id: 'default'`) shipped 62 times and
 * how `books` accreted ~477 fields, ~140 of them written by a single sweep or
 * import and then abandoned. This is the CODE-LEVEL schema guard until the
 * DB-level $jsonSchema validator (issue #3969 Track A, needs a dbAdmin
 * credential) lands — and the right ergonomics even after it does: unknown
 * keys THROW at construction time, so the 478th field cannot ship silently.
 *
 * The whitelists are the measured union of every field the direct-import
 * scripts wrote as of 2026-08-13 (AST scan of the insertOne/insertMany
 * literals in scripts/import/*.mjs, scripts/import-*-artworks.mjs,
 * scripts/iiif-discovery/import-*.mjs — artwork importers insert into `books`
 * too, hence the artwork/museum fields), widened on 2026-08-14 by the 50
 * scripts that actually adopted the constructors: the first scan read only
 * top-level literal keys, so keys reached through a helper's `return {…}`, a
 * conditional spread, or a `.ts` importer were invisible until the call threw.
 * They describe what imports DO write, not what they SHOULD; known duplicate
 * families (pageCount vs pages_count, place_of_publication vs place_published,
 * image_full vs commons_full_url) are kept so existing scripts can adopt this
 * without churn, and get consolidated by #3969 Track B.
 *
 * Adding a field here is a deliberate, reviewed act — that is the point.
 * Retired fields (see RETIRED_FIELDS) are refused with a pointed message and
 * must never come back.
 *
 * Usage:
 *   import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
 *   const bookDoc = makeBookDoc({ _id: bookId, id: bookIdStr, slug, title, ... });
 *   await db.collection('books').insertOne(bookDoc);
 */

/**
 * Fields retired from the schema — refused even though old dumps still show
 * them, with the incident that retired each.
 */
export const RETIRED_FIELDS = Object.freeze({
  tenant_id: 'retired by PR #2085 + PR #3983 — canonical tenant membership is tenantId (UUID), set by partner-assignment maintenance, never by imports',
  tenantId: 'set only by partner-assignment maintenance, never by imports (issue #3969 family 1)',
  pageCount: 'retired #3969 family 3 — canonical is pages_count. On 186 books this held a stale PRE-SPLIT count, about half the truth',
  page_count: 'retired #3969 family 3 — canonical is pages_count',
  hide_reason: 'orphan sweep column, writer lost to history — use hidden_reason, and record sweep verdicts as rows via scripts/lib/sweep-log.mjs (issue #3969 family 2)',
});

/** Union of `books` fields written by the direct-import scripts (2026-08-13). */
export const BOOK_FIELDS = Object.freeze([
  // identity
  '_id', 'id', 'slug',
  // core bibliographic
  'title', 'display_title', 'display_author', 'original_title',
  'author', 'language', 'original_language',
  'published', 'year', 'original_work_year', 'date_earliest', 'date_latest',
  'publisher',
  'place_published', 'place_of_publication', // known duplicate family — #3969 Track B
  'categories', 'collections', 'curator_notes', 'description', 'faceted_tags',
  'notes', 'scholarly_notes',
  'normalized_title', 'normalized_author',
  'is_translation', 'text_role', 'text_source', 'translation_status',
  'content_type', 'work_id',
  // provenance / source
  'ia_identifier', 'source_fingerprint', 'image_source', 'contributing_library',
  'provider', 'held_by', 'current_location', 'attribution_note',
  'dublin_core', 'catalog_metadata', 'catalog_ids', 'field_provenance',
  'enrichment', 'linked_art', 'wikidata_id',
  'harvested_at', 'harvest_source', 'harvest_category',
  'metadata', 'metadata_quality', 'shelfmark', 'subject_geographic',
  'provenance_reference', 'acquisition_campaign',
  // pipeline / status
  'status', 'hidden', 'visible', 'pipeline_auto', 'pipeline_status',
  'processing_priority', 'processing_priority_breakdown',
  'needs_splitting', 'needs_splitting_reason',
  'archive_status', 'archive_completed_at', 'archive_metadata',
  // page accounting
  'pages_count',
  'page_count_source', 'pages_ocr', 'pages_translated', 'pages_archived',
  // pages carrying a Spanish edition (translations.es / legacy translation_es);
  // synced by scripts/maintenance/sync-pages-translated-es.mjs, read by /es
  'pages_translated_es',
  // language-keyed metadata glosses { es: { title } } — ONE map, never title_<lang>
  // columns; written by scripts/maintenance/localize-metadata.mjs (src/lib/localized.ts)
  'localized',
  // images / artwork (artwork docs live in `books` with resource_type set)
  'thumbnail', 'thumbnail_blob', 'resource_type', 'image_display',
  'image_full', 'image_source_url', 'image_thumb', 'archived_full_url',
  'image_width', 'image_height', 'full_width', 'full_height',
  'medium', 'dimensions', 'dimensions_display', 'department',
  'accession_number', 'micrio_id',
  'commons_assessment', 'commons_attribution_required', 'commons_categories',
  'commons_copyrighted', 'commons_credit', 'commons_description',
  'commons_full_url', 'commons_height', 'commons_license', 'commons_license_id',
  'commons_license_url', 'commons_mediatype', 'commons_page_title',
  'commons_restrictions', 'commons_sha1', 'commons_title', 'commons_upload_date',
  'commons_uploader', 'commons_url', 'commons_usage_terms', 'commons_width',
  'met_object_id', 'met_classification', 'met_department', 'met_dimensions',
  'met_dynasty', 'met_medium', 'met_period', 'met_reign',
  'rijksmuseum_id',
  // ORAEC corpus imports
  'oraec_id', 'oraec_bibliography', 'oraec_object_type', 'oraec_origplace',
  'oraec_period', 'oraec_sentence_count',
  // timestamps
  'created_at', 'updated_at',
]);

/** Union of `pages` fields written by the direct-import scripts (2026-08-13). */
export const PAGE_FIELDS = Object.freeze([
  // identity
  '_id', 'id', 'book_id', 'page_number', 'page_label', 'part_title',
  'source_page', 'source_ref',
  // images
  'photo', 'photo_original', 'display_photo', 'archived_photo',
  'thumbnail', 'image_thumb', 'thumbnail_blob',
  'image_width', 'image_height', 'width', 'height',
  // text
  'ocr', 'summary', 'translation', 'transliteration',
  // pipeline
  'status', 'archive_metadata',
  // timestamps
  'created_at', 'updated_at',
]);

const BOOK_FIELD_SET = new Set(BOOK_FIELDS);
const PAGE_FIELD_SET = new Set(PAGE_FIELDS);

function makeDoc(fields, allowed, label) {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new TypeError(`${label}: expected a plain object of fields, got ${Object.prototype.toString.call(fields)}`);
  }
  const keys = Object.keys(fields);
  const retired = keys.filter((k) => k in RETIRED_FIELDS);
  if (retired.length > 0) {
    throw new Error(
      `${label}: retired field(s) refused: ${retired.map((k) => `${k} (${RETIRED_FIELDS[k]})`).join('; ')}`
    );
  }
  const unknown = keys.filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `${label}: unknown field(s): ${unknown.join(', ')}. ` +
        'New fields are a deliberate act (issue #3969) — add them to the whitelist in scripts/lib/book-docs.mjs, ' +
        'or record per-book sweep actions as rows via scripts/lib/sweep-log.mjs instead.'
    );
  }
  const doc = { ...fields };
  const now = new Date();
  if (doc.created_at === undefined) doc.created_at = now;
  if (doc.updated_at === undefined) doc.updated_at = now;
  return doc;
}

/**
 * Build a `books` insert doc, throwing if any key is not on the whitelist.
 * Fills created_at/updated_at with the current time when absent.
 * @param {object} fields
 * @returns {object} the validated doc (a shallow copy)
 */
export function makeBookDoc(fields) {
  return makeDoc(fields, BOOK_FIELD_SET, 'makeBookDoc');
}

/**
 * Build a `pages` insert doc, throwing if any key is not on the whitelist.
 * Fills created_at/updated_at with the current time when absent.
 * @param {object} fields
 * @returns {object} the validated doc (a shallow copy)
 */
export function makePageDoc(fields) {
  return makeDoc(fields, PAGE_FIELD_SET, 'makePageDoc');
}
