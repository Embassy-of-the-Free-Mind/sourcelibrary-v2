/**
 * Reconcile DB batch_jobs state with real Gemini-side state (#4889).
 *
 * PRIOR ART: scripts/workers/batch-collector.mjs `reconcileBatchState` — this IS
 * that function, moved out of the 1,750-line worker (which runs `run()` at module
 * load and so cannot be imported by a test) with its verdicts made testable.
 *
 * The invariant this module exists to hold: **a ghost verdict comes from asking
 * Gemini about the job itself, never from the job's absence in a listing.**
 *
 * What went wrong before (issue #4889, forum-of-conscience drain, 2026-09-15):
 * the listing walk stopped after 50 consecutive inactive jobs, the listing is
 * newest-first, and under load every RUNNING job older than that window was
 * simply absent from the set. Once >30 min old it was written as
 * `failed: 'Ghost: named in DB but 404 on all Gemini keys'`. None of those 85
 * jobs (8,770 pages) had returned 404 — all were RUNNING when asked directly and
 * later SUCCEEDED, billed, and never collected, while the submitter re-sent the
 * same pages because `failed` is not "in flight".
 *
 * Four rules, each pinned by tests/unit/batch-reconcile-ghost.test.ts:
 *   1. A candidate ghost is PROBED with `batches.get` on every key. Only a real
 *      404 on every key is a ghost. Any key that errors some other way (network,
 *      quota, 5xx) makes the verdict UNMEASURABLE and the row is left alone —
 *      an unmeasurable is not a death sentence.
 *   2. The listing walk has an explicit page budget and LOGS when it is hit, so
 *      a truncated listing is visible rather than silent.
 *   3. Orphan cancellation skips any job name the DB knows in ANY status. A job
 *      a previous cycle failed is not an orphan; cancelling it destroys paid work.
 *   4. The verdict's inputs (key index, key fingerprint, HTTP status per key) are
 *      written on the row, so the next false 404 is auditable rather than a
 *      bare sentence.
 */

import { createHash } from 'node:crypto';

export const ACTIVE_STATES = new Set(['JOB_STATE_PENDING', 'JOB_STATE_RUNNING']);

/** DB statuses that mean "we think this job is still in flight". */
export const DB_ACTIVE_STATUSES = ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'];

/** Pages of 100 walked per key before the listing is declared truncated. */
export const DEFAULT_LIST_PAGE_BUDGET = 20;
export const LIST_PAGE_SIZE = 100;

/** Ghost probes per cycle — bounds the batches.get storm under a large backlog. */
export const DEFAULT_PROBE_BUDGET = 200;

/** Age below which a named DB job is not yet probed (fresh jobs take a moment to appear). */
export const GHOST_MIN_AGE_MS = 30 * 60 * 1000;

export const GHOST_ERROR = 'Ghost: batches.get returned 404 on every Gemini key';

/**
 * Non-reversible, stable-across-runs fingerprint for an API key, so a verdict
 * record can say WHICH key returned what without ever writing the key.
 */
export function keyFingerprint(apiKey) {
  if (!apiKey) return null;
  return createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 8);
}

/**
 * Classify an SDK/API error: a real "does not exist" versus everything else.
 * The @google/genai ApiError carries a numeric `status`; older paths only have
 * the message. Only a 404 counts as not-found — a 403 is a key that cannot see
 * the job, which is key drift, not a dead job.
 */
export function isNotFoundError(err) {
  if (!err) return false;
  if (err.status === 404) return true;
  if (typeof err.status === 'number') return false;
  const msg = String(err.message || '');
  return /\b404\b/.test(msg) || /NOT_FOUND/.test(msg) || /\bnot found\b/i.test(msg);
}

/**
 * Ask every key about one job. Returns the verdict and the per-key attempts.
 *
 *   { verdict: 'exists', sdkJob, keyIndex, attempts }
 *   { verdict: 'not_found', attempts }        — a genuine 404 on EVERY key
 *   { verdict: 'unmeasurable', attempts }     — at least one key could not answer
 *
 * `attempts[i]` = { key_index, key: <fingerprint>, result: 'found'|'not_found'|'error', status, message }.
 */
export async function probeBatchJob(jobName, clients, keys = []) {
  const attempts = [];
  for (let i = 0; i < clients.length; i++) {
    const attempt = { key_index: i, key: keyFingerprint(keys[i]) };
    try {
      const sdkJob = await clients[i].batches.get({ name: jobName });
      if (sdkJob) {
        attempt.result = 'found';
        attempt.state = sdkJob.state || 'UNKNOWN';
        attempts.push(attempt);
        return { verdict: 'exists', sdkJob, keyIndex: i, attempts };
      }
      attempt.result = 'error';
      attempt.message = 'empty response';
    } catch (e) {
      attempt.result = isNotFoundError(e) ? 'not_found' : 'error';
      if (typeof e?.status === 'number') attempt.status = e.status;
      attempt.message = String(e?.message || e).slice(0, 160);
    }
    attempts.push(attempt);
  }
  const allNotFound = attempts.length > 0 && attempts.every(a => a.result === 'not_found');
  return { verdict: allNotFound ? 'not_found' : 'unmeasurable', attempts };
}

/**
 * Walk each key's batches.list newest-first, up to a page budget, and return
 * the ACTIVE job names seen. The set is a LOWER BOUND on what exists — never
 * infer non-existence from absence here (rule 1).
 */
export async function listActiveJobs(clients, { pageBudget = DEFAULT_LIST_PAGE_BUDGET, log = console.log } = {}) {
  const activeNames = new Set();
  const perKey = [];
  const issues = [];
  let truncated = false;
  const itemBudget = pageBudget * LIST_PAGE_SIZE;
  for (let i = 0; i < clients.length; i++) {
    let keyActive = 0;
    let seen = 0;
    let keyTruncated = false;
    try {
      const pager = await clients[i].batches.list({ config: { pageSize: LIST_PAGE_SIZE } });
      for await (const job of pager) {
        seen++;
        if (ACTIVE_STATES.has(job.state)) {
          keyActive++;
          if (job.name) activeNames.add(job.name);
        }
        if (seen >= itemBudget) { keyTruncated = true; break; }
      }
    } catch (err) {
      issues.push(`Key ${i} list failed: ${String(err?.message || err).substring(0, 80)}`);
    }
    if (keyTruncated) {
      truncated = true;
      const msg = `Key ${i} listing truncated at page budget (${pageBudget} pages, ${seen} jobs seen, ${keyActive} active) — older active jobs are NOT in the listed set`;
      issues.push(msg);
      log(`[batch-health] ${msg}`);
    }
    perKey.push({ active: keyActive, seen, truncated: keyTruncated });
  }
  return { activeNames, perKey, issues, truncated };
}

function jobNameOf(j) { return j.job_name || j.gemini_job_name; }

/**
 * Reconcile DB batch_jobs with Gemini. `deps`:
 *   clients      — GoogleGenAI clients, one per unique key (required)
 *   keys         — the matching API keys (only fingerprinted, never written)
 *   closePlaceholder(db, job, reason) — meter close-out for a terminal verdict (optional)
 *   dryRun       — no DB writes, no cancels
 *   now          — clock, for tests
 *   log          — console.log substitute
 *   pageBudget / probeBudget — see the constants above
 */
export async function reconcileBatchState(db, deps) {
  const {
    clients,
    keys = [],
    closePlaceholder = null,
    dryRun = false,
    now = () => Date.now(),
    log = console.log,
    pageBudget = DEFAULT_LIST_PAGE_BUDGET,
    probeBudget = DEFAULT_PROBE_BUDGET,
  } = deps;
  if (!Array.isArray(clients) || clients.length === 0) throw new Error('reconcileBatchState: clients required');

  const result = {
    geminiActive: 0,
    geminiActiveByKey: [],
    listingTruncated: false,
    dbActive: 0,
    dbZombies: 0,
    orphansCancelled: 0,
    orphansSparedKnownToDb: 0,
    ghostCandidates: 0,
    ghostsProbed: 0,
    ghostsConfirmed: 0,
    ghostsAlive: 0,
    ghostsUnmeasurable: 0,
    ghostsDetected: 0, // kept for /status readers: == ghostsConfirmed
    recentCompletions1h: 0,
    recentCompletions6h: 0,
    recentPagesSaved1h: 0,
    recentPagesSaved6h: 0,
    healthy: true,
    issues: [],
  };

  // 1. Active jobs per key, from a page-budgeted listing (rule 2).
  const listing = await listActiveJobs(clients, { pageBudget, log });
  result.geminiActiveByKey = listing.perKey.map(k => k.active);
  result.geminiActive = result.geminiActiveByKey.reduce((a, b) => a + b, 0);
  result.listingTruncated = listing.truncated;
  result.issues.push(...listing.issues);

  // 2. DB active jobs and zombies (named-but-never-submitted).
  const dbActiveJobs = await db.collection('batch_jobs').find({
    status: { $in: DB_ACTIVE_STATUSES },
  }).project({ _id: 1, id: 1, job_name: 1, gemini_job_name: 1, status: 1, created_at: 1, type: 1, model: 1, book_id: 1, page_count: 1, page_ids: 1 }).toArray();
  result.dbActive = dbActiveJobs.length;

  const zombies = dbActiveJobs.filter(j => !jobNameOf(j));
  result.dbZombies = zombies.length;
  if (zombies.length > 0) {
    const oneHourAgo = new Date(now() - 3600000);
    const staleZombies = zombies.filter(z => new Date(z.created_at) < oneHourAgo);
    if (staleZombies.length > 0 && !dryRun) {
      await db.collection('batch_jobs').updateMany(
        { _id: { $in: staleZombies.map(z => z._id) } },
        { $set: { status: 'cancelled', cancelled_at: new Date(now()), cancel_reason: 'batch-health: zombie (no gemini_job_name, >1h old)' } }
      );
      result.dbZombies = staleZombies.length;
      result.issues.push(`Auto-cancelled ${staleZombies.length} DB zombie jobs`);
    }
  }

  // 3. Gemini orphans: active on Gemini and unknown to the DB in ANY status (rule 3).
  const dbActiveNames = new Set(dbActiveJobs.map(jobNameOf).filter(Boolean));
  const orphanCandidates = [...listing.activeNames].filter(name => !dbActiveNames.has(name));
  if (orphanCandidates.length > 0) {
    const known = await db.collection('batch_jobs').find(
      { $or: [{ job_name: { $in: orphanCandidates } }, { gemini_job_name: { $in: orphanCandidates } }] },
    ).project({ job_name: 1, gemini_job_name: 1, status: 1 }).toArray();
    const knownNames = new Set();
    for (const k of known) {
      if (k.job_name) knownNames.add(k.job_name);
      if (k.gemini_job_name) knownNames.add(k.gemini_job_name);
    }
    result.orphansSparedKnownToDb = orphanCandidates.filter(n => knownNames.has(n)).length;
    if (result.orphansSparedKnownToDb > 0) {
      log(`[batch-health] ${result.orphansSparedKnownToDb} Gemini-active jobs are known to the DB in a non-active status — NOT cancelling (a failed row is not an orphan)`);
    }
    const orphanNames = orphanCandidates.filter(n => !knownNames.has(n));
    for (const name of orphanNames) {
      if (dryRun) { log(`[batch-health] dry-run: would cancel orphan ${name}`); continue; }
      for (const client of clients) {
        try { await client.batches.cancel({ name }); result.orphansCancelled++; break; } catch (_) { /* wrong key — try next */ }
      }
    }
    if (result.orphansCancelled > 0) result.issues.push(`Cancelled ${result.orphansCancelled} Gemini orphans`);
  }

  // 3b. Ghost candidates: named in the DB, active there, NOT in the listed set,
  // and old enough that a fresh submission would have shown up. Each is PROBED
  // (rule 1); the listing only chooses whom to ask.
  const minAge = new Date(now() - GHOST_MIN_AGE_MS);
  const candidates = dbActiveJobs.filter(j => {
    const name = jobNameOf(j);
    return name && !listing.activeNames.has(name) && new Date(j.created_at) < minAge;
  });
  result.ghostCandidates = candidates.length;
  if (candidates.length > probeBudget) {
    result.issues.push(`Ghost probe budget hit: ${candidates.length} candidates, probing ${probeBudget} this cycle`);
  }
  const confirmed = [];
  for (const job of candidates.slice(0, probeBudget)) {
    const name = jobNameOf(job);
    const probe = await probeBatchJob(name, clients, keys);
    result.ghostsProbed++;
    const record = {
      probed_at: new Date(now()),
      verdict: probe.verdict,
      state: probe.sdkJob?.state || null,
      keys_tried: probe.attempts.length,
      attempts: probe.attempts,
    };
    if (probe.verdict === 'exists') {
      result.ghostsAlive++;
      // Alive: the normal collection pass owns it. No status change; a light
      // note so a future "why was this never failed?" has an answer.
      if (!dryRun) {
        await db.collection('batch_jobs').updateOne({ _id: job._id }, { $set: { last_ghost_probe: record } });
      }
      continue;
    }
    if (probe.verdict === 'unmeasurable') {
      result.ghostsUnmeasurable++;
      if (!dryRun) {
        await db.collection('batch_jobs').updateOne({ _id: job._id }, { $set: { last_ghost_probe: record } });
      }
      continue;
    }
    confirmed.push({ job, record });
  }
  result.ghostsConfirmed = confirmed.length;
  result.ghostsDetected = confirmed.length;
  if (confirmed.length > 0) {
    if (!dryRun) {
      for (const { job, record } of confirmed) {
        await db.collection('batch_jobs').updateOne(
          { _id: job._id, status: { $in: DB_ACTIVE_STATUSES } },
          { $set: { status: 'failed', error: GHOST_ERROR, ghost_verdict: record, updated_at: new Date(now()) } }
        );
        if (closePlaceholder) {
          try { await closePlaceholder(db, job, GHOST_ERROR); } catch (_) { /* best-effort meter close */ }
        }
      }
    }
    result.issues.push(`Auto-failed ${confirmed.length} ghost jobs (batches.get 404 on all ${clients.length} keys)`);
  }
  if (result.ghostsAlive > 0) {
    log(`[batch-health] ${result.ghostsAlive} jobs absent from the listing are ALIVE on Gemini (left as-is)${listing.truncated ? ' — expected: the listing was truncated' : ''}`);
  }
  if (result.ghostsUnmeasurable > 0) {
    result.issues.push(`${result.ghostsUnmeasurable} ghost candidates unmeasurable (a key errored) — left untouched`);
  }

  // 4. Recent completion velocity.
  const t = now();
  result.recentCompletions1h = await db.collection('batch_jobs').countDocuments({
    status: { $in: ['completed', 'saved'] }, updated_at: { $gte: new Date(t - 3600000) }
  });
  result.recentCompletions6h = await db.collection('batch_jobs').countDocuments({
    status: { $in: ['completed', 'saved'] }, updated_at: { $gte: new Date(t - 6 * 3600000) }
  });
  result.recentPagesSaved1h = await db.collection('pages').countDocuments({
    'ocr.updated_at': { $gte: new Date(t - 3600000) }
  });
  result.recentPagesSaved6h = await db.collection('pages').countDocuments({
    'ocr.updated_at': { $gte: new Date(t - 6 * 3600000) }
  });

  // 5. Health assessment.
  if (result.geminiActive > 80) {
    result.healthy = false;
    result.issues.push(`Gemini active jobs (${result.geminiActive}) near limit (100)`);
  }
  if (result.dbZombies > 10) {
    result.healthy = false;
    result.issues.push(`${result.dbZombies} DB zombie jobs`);
  }
  if (result.geminiActive > 0 && result.recentCompletions1h === 0 && result.recentPagesSaved1h === 0) {
    result.healthy = false;
    result.issues.push(`${result.geminiActive} Gemini jobs active but 0 completions in last hour`);
  }

  return result;
}
