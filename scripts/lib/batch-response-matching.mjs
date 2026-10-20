// PRIOR ART: scripts/workers/batch-collector.mjs (already fixed, single-file,
// not shared — the same metadata.key/no-index-fallback logic lives inline
// there and isn't exported); scripts/lib/entity-page-match.mjs and
// scripts/lib/embed-book-page-texts.mjs (unrelated matching — entity/page
// attribution and embedding text extraction, not Gemini batch responses).
// No existing shared helper matches Gemini Batch API responses back to the
// page ids a job submitted — this is a new, narrow extraction so the logic
// is unit-testable without standing up Mongo or the Gemini API (#4685(b)).

/**
 * Match Gemini Batch API responses to the page ids a single-page-per-request
 * job (OCR or translation) actually submitted.
 *
 * Pure, no DB/network access — safe to import in a unit test.
 *
 * NEVER falls back to index-based matching (`job.page_ids[idx]`) — Gemini
 * Batch API does not guarantee response order matches request order. That
 * fallback caused the 2026-03-24 cross-book contamination incident (see
 * scripts/maintenance/fix-batch-contamination.mjs): scripts/workers/batch-collector.mjs
 * was fixed to drop it at the time, but scripts/batch/collect-batch-results.mjs
 * — a separate collector, cron'd every 30 min in production
 * (scripts/workers/crontab.production) — never got the same fix and kept
 * silently mismatching pages for 4 more months (#4685).
 *
 * A response also has to name a page that was actually IN this job's own
 * page_ids — a metadata.key that resolves to a page outside the job (a
 * stray/duplicate response) must not overwrite it either, and a metadata.key
 * that repeats within the same job keeps only its first response.
 *
 * @param {Array} responses - raw Gemini batch response lines
 * @param {string[]} jobPageIds - job.page_ids, the ids that were submitted
 * @param {(reason: string) => void} noteFail - called once per skipped response with a short reason tag
 * @returns {{ pageResults: {pageId: string, text: string, usage: object|undefined}[], failCount: number }}
 */
export function resolveSinglePageBatchResponses(responses, jobPageIds, noteFail) {
  const validPageIdSet = new Set(jobPageIds || []);
  const seenPageIds = new Set();
  const pageResults = [];
  let failCount = 0;
  const fail = (reason) => { failCount++; noteFail(reason); };

  for (const result of responses || []) {
    const pageId = result.metadata?.key;
    if (!pageId) { fail('missing-metadata-key'); continue; }
    if (!validPageIdSet.has(pageId)) { fail('metadata-key-not-in-job'); continue; }
    if (result.error) { fail(`error:${String(result.error?.status || result.error?.code || result.error).slice(0, 60)}`); continue; }
    const candidate = result.response?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) { fail(`no-text:${candidate?.finishReason || 'no-candidate'}`); continue; }
    if (seenPageIds.has(pageId)) { fail('duplicate-metadata-key'); continue; }
    seenPageIds.add(pageId);
    pageResults.push({ pageId, text, usage: result.response?.usageMetadata });
  }

  return { pageResults, failCount };
}

/**
 * Which page ids from a submitted batch job never received a write, and so
 * need a failure marker so they stop looking "never queued" (#4685(b)).
 * Excludes ids that were skipped deliberately (human-edited/protected).
 *
 * @param {string[]} jobPageIds
 * @param {Set<string>|string[]} writtenPageIds
 * @param {Set<string>|string[]} [protectedPageIds]
 * @returns {string[]}
 */
export function findUnresolvedPageIds(jobPageIds, writtenPageIds, protectedPageIds = new Set()) {
  const written = writtenPageIds instanceof Set ? writtenPageIds : new Set(writtenPageIds);
  const protectedIds = protectedPageIds instanceof Set ? protectedPageIds : new Set(protectedPageIds);
  return (jobPageIds || []).filter(id => !written.has(id) && !protectedIds.has(id));
}
