/**
 * Phase 2 work-ID dedup: is there already a completed copy of THIS book? (#4833)
 *
 * PRIOR ART: scripts/workers/pipeline-orchestrator.mjs filterDuplicateWorks — the
 * inline version this replaces; it read a status label as "completed copy" and
 * compared works, not volumes. scripts/maintenance/requeue-untranslated-complete.mjs
 * — source of the 0.9 × pages_count "full text" test reused here.
 *
 * Two defects in the old test:
 *  1. Phase 9 writes `complete` from OCR coverage alone, so a 25-page PREVIEW
 *     sibling carried a completed status. A status label is not evidence of
 *     output (pipeline-status-truth.md): a sibling only counts when it holds
 *     full text, pages_ocr >= 0.9 × pages_count.
 *  2. Volumes of one work share a work_id by design (work-identity.md), so a
 *     work-level test blocks vol. 2 forever once vol. 1 finishes. The volume
 *     slot of `edition_key` (`…|v<volume>`) is a both-sides veto: two books
 *     whose keys name DIFFERENT volumes are not copies of each other. A missing
 *     volume on either side is non-distinguishing (the old behaviour).
 */

export const COMPLETED_COPY_STATUSES = ['complete', 'translate_complete', 'chapters_complete', 'images_complete', 'enriched'];
export const FULL_TEXT_RATIO = 0.9;

/** Volume slot of an edition_key (`title|author|year|v<volume>`), or null if absent/empty. */
export function editionKeyVolume(editionKey) {
  if (typeof editionKey !== 'string') return null;
  const slot = editionKey.slice(editionKey.lastIndexOf('|') + 1);
  if (!slot.startsWith('v')) return null;
  const vol = slot.slice(1).trim();
  return vol === '' ? null : vol;
}

/** A sibling holds full text: OCR covers at least 90% of its pages. */
export function hasFullText(book) {
  const count = book?.pages_count || 0;
  return count > 0 && (book.pages_ocr || 0) >= FULL_TEXT_RATIO * count;
}

/** Does `sibling` (already known complete-status, visible, same work) stand in for `candidate`? */
export function isCompletedCopyOf(candidate, sibling) {
  if (!candidate?.work_id || sibling?.work_id !== candidate.work_id) return false;
  if (sibling.id && sibling.id === candidate.id) return false;
  if (!hasFullText(sibling)) return false;
  const cv = editionKeyVolume(candidate.edition_key);
  const sv = editionKeyVolume(sibling.edition_key);
  if (cv && sv && cv !== sv) return false;
  return true;
}

/**
 * Drop candidates that already have a completed copy. Returns
 * { kept, skipped } where skipped is [{ book, copyId }].
 */
export async function filterCompletedCopies(db, candidates) {
  const workIds = [...new Set(candidates.filter(b => b.work_id).map(b => b.work_id))];
  if (workIds.length === 0) return { kept: candidates, skipped: [] };

  const siblings = await db.collection('books').find({
    work_id: { $in: workIds },
    'pipeline_auto.status': { $in: COMPLETED_COPY_STATUSES },
    hidden: { $ne: true },
    pages_count: { $gt: 0 },
    $expr: { $gte: [{ $ifNull: ['$pages_ocr', 0] }, { $multiply: ['$pages_count', FULL_TEXT_RATIO] }] },
  }, { projection: { id: 1, work_id: 1, edition_key: 1, pages_count: 1, pages_ocr: 1 } }).toArray();

  const byWork = new Map();
  for (const s of siblings) {
    if (!byWork.has(s.work_id)) byWork.set(s.work_id, []);
    byWork.get(s.work_id).push(s);
  }

  const kept = [];
  const skipped = [];
  for (const b of candidates) {
    const copy = b.work_id ? (byWork.get(b.work_id) || []).find(s => isCompletedCopyOf(b, s)) : null;
    if (copy) skipped.push({ book: b, copyId: copy.id });
    else kept.push(b);
  }
  return { kept, skipped };
}
