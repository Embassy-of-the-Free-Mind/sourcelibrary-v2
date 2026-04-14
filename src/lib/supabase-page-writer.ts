/**
 * Dual-write helper: sync page updates to Supabase Postgres.
 * Issue #947 Phase 2 — runs alongside MongoDB writes during transition.
 *
 * Fire-and-forget: if Supabase fails, MongoDB remains source of truth.
 */

import { supabaseAdmin } from './supabase';

/**
 * Flatten a MongoDB $set update into Supabase column format.
 */
function flattenUpdate(mongoSet: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(mongoSet)) {
    if (key === 'ocr' && typeof value === 'object' && value !== null) {
      const ocr = value as Record<string, unknown>;
      if ('data' in ocr) row.ocr_data = typeof ocr.data === 'string' ? ocr.data : null;
      if ('updated_at' in ocr) row.ocr_updated_at = ocr.updated_at ? new Date(ocr.updated_at as string).toISOString() : null;
      if ('model' in ocr) row.ocr_model = ocr.model || null;
      if ('language' in ocr) row.ocr_language = ocr.language || null;
      if ('source' in ocr) row.ocr_source = ocr.source || null;
      if ('prompt_version' in ocr) row.ocr_prompt_version = ocr.prompt_version || null;
      if ('batch_job_id' in ocr) row.ocr_batch_job_id = ocr.batch_job_id || null;
      if ('input_tokens' in ocr) row.ocr_input_tokens = ocr.input_tokens || null;
      if ('output_tokens' in ocr) row.ocr_output_tokens = ocr.output_tokens || null;
    } else if (key === 'translation' && typeof value === 'object' && value !== null) {
      const t = value as Record<string, unknown>;
      if ('data' in t) row.translation_data = typeof t.data === 'string' ? t.data : null;
      if ('updated_at' in t) row.translation_updated_at = t.updated_at ? new Date(t.updated_at as string).toISOString() : null;
      if ('model' in t) row.translation_model = t.model || null;
      if ('language' in t) row.translation_language = t.language || null;
      if ('source_language' in t) row.translation_source_language = t.source_language || null;
      if ('source' in t) row.translation_source = t.source || null;
      if ('prompt_version' in t) row.translation_prompt_version = t.prompt_version || null;
      if ('batch_job_id' in t) row.translation_batch_job_id = t.batch_job_id || null;
      if ('input_tokens' in t) row.translation_input_tokens = t.input_tokens || null;
      if ('output_tokens' in t) row.translation_output_tokens = t.output_tokens || null;
      if ('recitation_blocked' in t) row.translation_recitation_blocked = !!t.recitation_blocked;
      if ('safety_blocked' in t) row.translation_safety_blocked = !!t.safety_blocked;
      if ('safety_reason' in t) row.translation_safety_reason = t.safety_reason || null;
    } else if (key === 'updated_at') {
      row.updated_at = value ? new Date(value as string).toISOString() : new Date().toISOString();
    } else if (key === 'page_type') row.page_type = value || null;
    else if (key === 'columns') row.columns = value || 1;
    else if (key === 'script_type') row.script_type = value || null;
    else if (key === 'detected_images') row.detected_images = value || null;
    else if (key === 'image_extraction_updated_at') row.image_extraction_updated_at = value ? new Date(value as string).toISOString() : null;
    else if (key === 'image_extraction_prompt_version') { /* not in schema, skip */ }
    else if (key === 'archived_photo') row.archived_photo = value || null;
    else if (key === 'cropped_photo') row.cropped_photo = value || null;
    else if (key === 'crop') row.crop = value || null;
  }

  return row;
}

/**
 * Update a single page on Supabase. Fire-and-forget.
 */
export function syncPageUpdate(pageId: string, mongoSet: Record<string, unknown>): void {
  if (!supabaseAdmin) return;
  const row = flattenUpdate(mongoSet);
  if (Object.keys(row).length === 0) return;

  supabaseAdmin
    .from('pages')
    .update(row)
    .eq('id', pageId)
    .then(({ error }) => {
      if (error) console.warn(`[supabase-page-writer] Update failed for ${pageId}: ${error.message}`);
    });
}
