/**
 * Dual-write helper: sync page updates to Supabase Postgres.
 * Issue #947 Phase 2 — runs alongside MongoDB writes during transition.
 *
 * All writes are fire-and-forget (non-blocking). If Supabase fails,
 * MongoDB remains the source of truth. Parity is verified separately.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.warn('[supabase-page-writer] No SUPABASE_SERVICE_ROLE_KEY — page dual-write disabled');
}

// Map from MongoDB field paths to Supabase column names
const FIELD_MAP = {
  // OCR fields (dot-notation and subdoc)
  'ocr.data': 'ocr_data', 'ocr.updated_at': 'ocr_updated_at', 'ocr.model': 'ocr_model',
  'ocr.language': 'ocr_language', 'ocr.source': 'ocr_source',
  'ocr.prompt_version': 'ocr_prompt_version',
  'ocr.prompt_id': 'ocr_prompt_id', 'ocr.prompt_hash': 'ocr_prompt_hash', 'ocr.prompt_name': 'ocr_prompt_name',
  'ocr.batch_job_id': 'ocr_batch_job_id', 'ocr.input_tokens': 'ocr_input_tokens', 'ocr.output_tokens': 'ocr_output_tokens',
  // Translation fields (dot-notation and subdoc)
  'translation.data': 'translation_data', 'translation.updated_at': 'translation_updated_at',
  'translation.model': 'translation_model', 'translation.language': 'translation_language',
  'translation.source_language': 'translation_source_language', 'translation.source': 'translation_source',
  'translation.target_language': null, // not in Supabase schema
  'translation.prompt_version': 'translation_prompt_version',
  'translation.prompt_id': 'translation_prompt_id', 'translation.prompt_hash': 'translation_prompt_hash', 'translation.prompt_name': 'translation_prompt_name',
  'translation.batch_job_id': 'translation_batch_job_id',
  'translation.input_tokens': 'translation_input_tokens', 'translation.output_tokens': 'translation_output_tokens',
  'translation.recitation_blocked': 'translation_recitation_blocked',
  'translation.safety_blocked': 'translation_safety_blocked', 'translation.safety_reason': 'translation_safety_reason',
  // Top-level fields
  'updated_at': 'updated_at', 'page_type': 'page_type', 'columns': 'columns', 'script_type': 'script_type',
  'detected_images': 'detected_images', 'image_extraction_updated_at': 'image_extraction_updated_at',
  'archived_photo': 'archived_photo', 'cropped_photo': 'cropped_photo', 'crop': 'crop',
};

const TIMESTAMP_COLS = new Set(['ocr_updated_at', 'translation_updated_at', 'updated_at', 'image_extraction_updated_at']);

/**
 * Flatten a MongoDB $set update into Supabase column format.
 * Handles both nested subdocs ({ocr: {data: ...}}) and dot-notation ({'ocr.data': ...}).
 */
function flattenUpdate(mongoSet) {
  const row = {};
  for (const [key, value] of Object.entries(mongoSet)) {
    // Check dot-notation first (e.g., 'ocr.data')
    if (key in FIELD_MAP) {
      const col = FIELD_MAP[key];
      if (col) row[col] = TIMESTAMP_COLS.has(col) && value ? new Date(value).toISOString() : value ?? null;
      continue;
    }
    // Handle full subdoc replacement (e.g., ocr: {data: ..., model: ...})
    if ((key === 'ocr' || key === 'translation') && typeof value === 'object' && value !== null) {
      for (const [k, v] of Object.entries(value)) {
        const dotKey = `${key}.${k}`;
        const col = FIELD_MAP[dotKey];
        if (col) row[col] = TIMESTAMP_COLS.has(col) && v ? new Date(v).toISOString() : v ?? null;
      }
      continue;
    }
    // Direct top-level match
    const col = FIELD_MAP[key];
    if (col) row[col] = TIMESTAMP_COLS.has(col) && value ? new Date(value).toISOString() : value ?? null;
  }
  return row;
}

/**
 * Update a single page on Supabase. Fire-and-forget.
 * @param {string} pageId - The page's `id` field
 * @param {object} mongoSet - The MongoDB $set payload (with nested subdocs)
 */
export function syncPageUpdate(pageId, mongoSet) {
  if (!SUPABASE_SERVICE_KEY) return;
  const row = flattenUpdate(mongoSet);
  if (Object.keys(row).length === 0) return;

  fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  }).catch(err => {
    console.warn(`[supabase-page-writer] Update failed for ${pageId}: ${err.message}`);
  });
}

/**
 * Batch update multiple pages on Supabase. Fire-and-forget.
 * Uses individual PATCHes (PostgREST doesn't support batch PATCH by different IDs).
 * @param {Array<{pageId: string, mongoSet: object}>} updates
 */
export function syncPageBatch(updates) {
  if (!SUPABASE_SERVICE_KEY) return;
  for (const { pageId, mongoSet } of updates) {
    syncPageUpdate(pageId, mongoSet);
  }
}

/**
 * Upsert pages (for batch-collector which may create new pages).
 * @param {Array<object>} rows - Flat Supabase row objects with `id` field
 */
export async function upsertPages(rows) {
  if (!SUPABASE_SERVICE_KEY || rows.length === 0) return;

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/pages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[supabase-page-writer] Upsert failed (${resp.status}): ${text.substring(0, 200)}`);
    }
  } catch (err) {
    console.warn(`[supabase-page-writer] Upsert error: ${err.message}`);
  }
}

export { flattenUpdate };
