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
 * Upload a JSONL Batch API input (resumable, one PUT, retried 3× 30 s apart).
 * The enrich lane's copy, moved here so the embedding lane can share it (#5729).
 * @returns {Promise<string>} the File API name (`files/<id>`)
 */
export async function uploadBatchInputFile(body, displayName, apiKey, { fetchImpl = fetch, retryMs = 30000 } = {}) {
  const start = await fetchImpl(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(Buffer.byteLength(body)), 'X-Goog-Upload-Header-Content-Type': 'text/plain',
    },
    body: JSON.stringify({ file: { displayName } }),
  });
  if (!start.ok) throw new Error(`upload start ${start.status}: ${await start.text()}`);
  const url = start.headers.get('X-Goog-Upload-URL');
  if (!url) throw new Error('no upload URL returned');
  for (let attempt = 1; ; attempt++) {
    const put = await fetchImpl(url, { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body })
      .catch(e => ({ ok: false, status: e.message }));
    if (put.ok) {
      const info = await put.json();
      if (!info.file?.name) throw new Error('upload returned no file name');
      return info.file.name;
    }
    if (attempt >= 3) throw new Error(`upload PUT failed: ${put.status}`);
    await new Promise(r => setTimeout(r, retryMs));
  }
}

/**
 * Stream a finished job's results file, one parsed JSONL line at a time. An
 * embedding result line is ~10 KB (768 floats as text), so a 20K-request job is
 * ~200 MB: read it as a stream, never as one string.
 */
export async function* streamBatchResponses(responsesFile, apiKey, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/download/v1beta/${responsesFile}:download?alt=media&key=${apiKey}`);
  if (!res.ok) throw new Error(`results download ${res.status}`);
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) yield JSON.parse(buf.trim());
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
