/**
 * Batch API key accounting for the pipeline orchestrator, by GCP PROJECT rather
 * than by key (#5544).
 *
 * Google's Batch API limits are per project: 100 concurrent batch jobs and
 * 20 GiB of File API storage (ai.google.dev/gemini-api/docs/rate-limits).
 * Several of our env keys belong to the same project: on 2026-10-01 the five
 * deduped keys were three projects (keys 1 and 4 return identical
 * `batches.list` and `files.list`, as do keys 2 and 3). Counting per key
 * counted those projects' jobs twice against the global cap.
 *
 * A key whose File API upload 429s on `file_storage_bytes` is "upload-full".
 * It used to be marked by setting its load to the per-key cap. That fake load
 * then counted toward the global total and stopped Phase 2 after 1–3 books. An
 * upload-full project can still run inline batches, so upload-full is now a
 * separate flag and is never counted as load.
 *
 * PRIOR ART: pipeline-orchestrator.mjs getLeastLoadedKey()/canSubmitMore()
 * (#1038). This module is those functions made pure and project-aware, and the
 * orchestrator now calls them. Nothing else in scripts/lib tracks Batch key load.
 */

/**
 * Map each key to the first key in the same project. Two keys are one project
 * when they list a common batch job: job names (`batches/<id>`) are unique, so
 * a shared name can only mean a shared project. Matching on overlap rather than
 * on an identical list keeps the alias when another lane creates a job between
 * the two list calls. A key that listed nothing stays its own project.
 * @param {(string[]|null|undefined)[]} jobNames newest job names each key lists
 * @returns {number[]} canonical index per key
 */
export function projectCanonicals(jobNames) {
  const owner = new Map(); // job name -> canonical key
  return jobNames.map((names, i) => {
    const hit = (names || []).find(n => owner.has(n));
    const canonical = hit !== undefined ? owner.get(hit) : i;
    for (const n of names || []) if (!owner.has(n)) owner.set(n, canonical);
    return canonical;
  });
}

/** Active jobs across distinct projects: each alias key's load is its canonical key's, counted once. */
export function projectTotal(loads, canonicals) {
  let total = 0;
  for (let i = 0; i < loads.length; i++) if (canonicals[i] === i) total += loads[i];
  return total;
}

/** Every key index in the same project as `ki`, ki included. */
export function projectMembers(ki, canonicals) {
  const c = canonicals[ki] ?? ki;
  const out = [];
  for (let i = 0; i < canonicals.length; i++) if ((canonicals[i] ?? i) === c) out.push(i);
  return out;
}

/**
 * Canonical keys under `cap` and not in `excluded`, least loaded first. Ties
 * keep key order, so the result is stable.
 * @param {number[]} loads
 * @param {{ canonicals: number[], cap: number, excluded?: Set<number> }} opts
 * @returns {number[]}
 */
export function keysWithRoom(loads, { canonicals, cap, excluded = new Set() }) {
  return loads
    .map((load, i) => ({ i, load }))
    .filter(({ i, load }) => canonicals[i] === i && !excluded.has(i) && load < cap)
    .sort((a, b) => a.load - b.load || a.i - b.i)
    .map(({ i }) => i);
}

/** True when an upload error is the project's File API storage quota, rather than any other failure. */
export function isFileQuotaError(message = '') {
  return /file_storage_bytes/.test(message)
    || /429|RESOURCE_EXHAUSTED|quota/i.test(message);
}
