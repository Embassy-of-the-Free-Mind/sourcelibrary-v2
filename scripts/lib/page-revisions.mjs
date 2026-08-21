import { randomBytes } from 'crypto';

/**
 * Scripts-side twin of src/lib/page-revisions.ts createRevision().
 *
 * Doctrine (system map): every write to pages.ocr.data or pages.translation.data
 * must save the existing content to `page_revisions` FIRST. A code path that
 * skips this destroys a before/after pair that can never be backfilled (#3240).
 *
 * Both helpers are no-ops when the page has no existing content for the field,
 * so callers can invoke them unconditionally — first writes cost one read and
 * store nothing. Failures never throw: losing a revision must not block the
 * content write itself.
 *
 * `reason` records why the content was superseded. Recommended values:
 *   'reocr_batch' | 'reocr_realtime' | 'retranslate_batch' | 'retranslate_stale' |
 *   'recitation_retry' | 'spread_split' | 'manual'
 */

// Placeholder texts that carry no content — not worth a revision document.
const MARKER_TEXTS = new Set(['[RECITATION_BLOCKED]']);

/**
 * Bulk variant: one find + one insertMany for a batch of page ids.
 * Returns the number of revisions written.
 */
export async function saveRevisionsBeforeOverwrite(db, pageIds, field, opts = {}) {
  const { jobId, reason } = opts;
  if (!pageIds || pageIds.length === 0) return 0;
  try {
    const pages = await db.collection('pages')
      .find({ id: { $in: pageIds } }, { projection: { id: 1, book_id: 1, [field]: 1 } })
      .toArray();

    const now = new Date();
    const docs = [];
    for (const page of pages) {
      const fieldData = page[field];
      if (!fieldData?.data) continue; // first write — nothing to retain
      if (MARKER_TEXTS.has(fieldData.data)) continue;
      docs.push({
        id: randomBytes(6).toString('hex'),
        page_id: page.id,
        book_id: page.book_id,
        field,
        data: fieldData.data,
        source: fieldData.source || 'ai',
        model: fieldData.model,
        language: field === 'ocr' ? fieldData.language : (fieldData.source_language || fieldData.language),
        prompt_version: fieldData.prompt_version,
        edited_by: fieldData.edited_by,
        job_id: fieldData.batch_job_id || jobId,
        ...(reason ? { reason } : {}),
        original_date: fieldData.updated_at || fieldData.edited_at,
        created_at: now,
      });
    }
    if (docs.length > 0) {
      await db.collection('page_revisions').insertMany(docs, { ordered: false });
    }
    return docs.length;
  } catch (e) {
    console.error(`[page-revisions] Failed to save revisions (${field}, ${pageIds.length} pages): ${e.message?.slice(0, 80)}`);
    return 0;
  }
}

/**
 * Single-page variant. Returns true if a revision was written.
 */
export async function saveRevisionBeforeOverwrite(db, pageId, field, opts = {}) {
  const n = await saveRevisionsBeforeOverwrite(db, [pageId], field, opts);
  return n > 0;
}
