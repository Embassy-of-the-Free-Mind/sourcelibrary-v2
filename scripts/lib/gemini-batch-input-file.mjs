/**
 * A Batch API input file is dead weight the moment `batchGenerateContent` has
 * accepted it: Gemini snapshots the input at create time, so the job runs and
 * completes with the file gone. The pipeline orchestrator has deleted its
 * inputs straight after create for months, and those jobs save normally.
 *
 * Left in place, an input counts against the project's 20 GiB File API quota
 * (`file_storage_bytes`, limit 21474836480) until batch-collector's hourly
 * sweep or the 48 h expiry removes it. Measured 2026-10-01 (#5544): key 0's
 * project held 20.86 GB, 536 `reocr-*` files (18.1 GB) from
 * bulk-reocr-local.mjs plus 67 `reread-*` files from reread-loop-pages.mjs, all
 * under 70 minutes old. Every other lane's upload to that project then 429'd.
 *
 * PRIOR ART: pipeline-orchestrator.mjs deletes its input inline after
 * createBatchJobFromFile (SDK client, not shareable with these fetch-based
 * scripts); batch-collector.mjs cleanupStaleFiles() is the hourly backstop for
 * anything this misses. Neither is reusable by a script that talks REST.
 */

// usage-ok: File API DELETE only — no model call, nothing billed.
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Delete one File API file. Never throws: a failed delete leaves the file for
 * the collector's sweep, and must not turn a submitted job into a reported failure.
 * @returns {Promise<boolean>} true when Gemini confirmed the delete (or it was already gone)
 */
export async function deleteGeminiFile(fileName, apiKey, { fetchImpl = fetch } = {}) {
  if (!fileName || !apiKey) return false;
  try {
    const res = await fetchImpl(`${GEMINI_API_BASE}/${fileName}?key=${apiKey}`, { method: 'DELETE' });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/**
 * Run `create()` (the batchGenerateContent call for an uploaded input), then
 * delete the input whether create succeeded or failed. A failed create's input
 * is pure waste; a successful one's is no longer needed. The create's result
 * or error is passed through unchanged.
 */
export async function createThenDeleteInput({ fileName, apiKey, create, fetchImpl = fetch }) {
  try {
    return await create();
  } finally {
    await deleteGeminiFile(fileName, apiKey, { fetchImpl });
  }
}
