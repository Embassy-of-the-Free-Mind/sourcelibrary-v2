/**
 * The Gemini side of the batch ledger (#6276): every job Gemini says it FINISHED must be
 * collected by something we run.
 *
 * PRIOR ART: scripts/workers/lib/batch-reconcile.mjs — walks batches.list too, but only to
 * count ACTIVE jobs and pick ghost candidates; it stops at a page budget and never asks
 * "was this SUCCEEDED job collected?". Its keyFingerprint() is reused here. scripts/audit/
 * paid-vs-got.mjs collectionCheck() — asks only the DB, and only about NON-terminal rows, so
 * a row wrongly written `cancelled`/`failed` is invisible to it (that is how #4889 and #6238
 * lost paid work). scripts/lib/gemini-batch-keys.mjs projectCanonicals() — reused to walk
 * each GCP project once instead of once per alias key. Nothing else joins Gemini's listing to
 * every store that records a batch job.
 *
 * Measured 2026-10-08 (read-only): 8 unique keys = 5 projects; Gemini retained 35,117 jobs back
 * to 2026-08-20; every listing came back strictly newest-first by createTime; a full walk took
 * ~4.5 min (one project holds 26K jobs). So the hourly mode walks a WINDOW (stops at the first
 * job older than it, and verifies the order as it goes), and the daily ledger walks everything.
 *
 * Three findings, each from Gemini's word about the job:
 *   succeeded_uncollected      Gemini SUCCEEDED; we hold a record of the job but none says its
 *                              output was read, and none is still in flight inside the grace.
 *   unknown_to_db              Gemini SUCCEEDED; no store we know records the job at all.
 *   terminal_while_alive       Gemini PENDING/RUNNING; every record we hold says it is over, so
 *                              nothing will collect it when it finishes.
 * A key that cannot be listed (or a window whose order breaks) makes the section UNKNOWN —
 * never clear (measurement-instruments.md).
 *
 * Three rules added 2026-10-09 (#6333), each from a finding that misled or went quiet:
 *   - A finding does not age out. It was demoted to WARN 48 h after Gemini ended the job, and it
 *     left the hourly listing window at 72 h, so an unfixed loss stopped paging without anyone
 *     having collected or discarded it. Now every finding is a FAIL until a store says the job
 *     was collected or discarded on purpose, and the hourly run carries forward the findings of
 *     its previous run that have left the window (carryForwardFindings).
 *   - "SUCCEEDED" is the job's state, not its requests'. Gemini ends a job SUCCEEDED when every
 *     request in it was cancelled (`batchStats.failedRequestCount == requestCount`, nothing
 *     billed, nothing to collect): 14 of the 55 findings of 2026-10-09 were that, 30,000
 *     requests in two `ep-*` jobs among them. settleFindings() reads Gemini's own tally and
 *     counts those as `empty`, not as paid work lost.
 *   - A discard is a record: discardBatchJob() (scripts/lib/end-batch-job.mjs) writes batch_jobs
 *     status `superseded` with a reason and the saved result's hash, on the job's own row or on
 *     a new one when no batch_jobs row names the job.
 */

import { keyFingerprint } from '../workers/lib/batch-reconcile.mjs';
import { projectCanonicals } from './gemini-batch-keys.mjs';

const HOUR = 3600e3;
export const LIST_PAGE_SIZE = 100;
/** A finished job whose record is still open is fine for this long after Gemini ended it. */
export const IN_FLIGHT_GRACE_H = 3;
/**
 * How long a finding carried forward from an earlier run is still asked about at Gemini. Past
 * this the hourly run stops re-reading it and the daily full walk owns it. Results outlive the
 * 48 h job expiry by weeks (2026-10-08: 283 SUCCEEDED jobs from 2026-09-15 still downloadable),
 * so this is a bound on work per run, not a claim that the output is gone.
 */
export const CARRY_FORWARD_DAYS = 45;
/** Hourly window: jobs Gemini CREATED within this many hours. Covers the 48 h expiry plus slack. */
export const HOURLY_WINDOW_H = 72;

export const SUCCEEDED = new Set(['JOB_STATE_SUCCEEDED', 'BATCH_STATE_SUCCEEDED']);
export const ALIVE = new Set(['JOB_STATE_PENDING', 'JOB_STATE_RUNNING', 'JOB_STATE_QUEUED',
  'BATCH_STATE_PENDING', 'BATCH_STATE_RUNNING']);

const ms = (d) => (d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : NaN);
const r1 = (n) => Math.round(n * 10) / 10;

// ─────────────────────────────────────────── listing

/**
 * List every key. Each key's first page is read so a key that cannot be listed is caught;
 * keys of the same project (they list the same job names) are walked once, through the first
 * key of that project. With `sinceMs` the walk stops at the first job created before it — safe
 * only because the listing is newest-first, which is checked on every item: one job newer than
 * its predecessor makes the listing UNKNOWN rather than trusting a window it cannot guarantee.
 *
 * Returns { jobs: Map<name, job>, perKey: [...], unknown: string[] }. `unknown` empty = complete.
 */
export async function listAllBatches(clients, { keys = [], sinceMs = null, log = () => {}, pageSize = LIST_PAGE_SIZE } = {}) {
  const unknown = [];
  const perKey = clients.map((_, i) => ({ key_index: i, key: keyFingerprint(keys[i]), listed: 0, pages: 0, ms: 0, stop: null, error: null, canonical: i }));
  const firstPages = [];
  const pagers = [];
  for (let i = 0; i < clients.length; i++) {
    const t0 = Date.now();
    try {
      const pager = await clients[i].batches.list({ config: { pageSize } });
      pagers[i] = pager;
      firstPages[i] = (pager.page || []).map((j) => j.name);
      perKey[i].pages = 1;
    } catch (e) {
      perKey[i].error = String(e?.message || e).slice(0, 160);
      unknown.push(`key ${i} (${perKey[i].key}) could not be listed: ${perKey[i].error}`);
      firstPages[i] = null;
    }
    perKey[i].ms += Date.now() - t0;
  }
  const canon = projectCanonicals(firstPages);
  const jobs = new Map();
  for (let i = 0; i < clients.length; i++) {
    perKey[i].canonical = canon[i];
    if (!pagers[i]) continue;
    if (canon[i] !== i) { perKey[i].stop = `alias of key ${canon[i]}`; continue; }
    const t0 = Date.now();
    let prev = Infinity;
    let seen = 0;
    try {
      for await (const job of pagers[i]) {
        seen++;
        const created = ms(job.createTime);
        if (created > prev + 1000) { // 1 s slack for clock jitter between shards
          if (sinceMs != null) {
            unknown.push(`key ${i}: listing not newest-first at item ${seen} (${job.name}) — a windowed walk cannot be trusted`);
            perKey[i].stop = 'order broken';
            break;
          }
        }
        prev = Math.min(prev, created);
        if (sinceMs != null && created < sinceMs) { perKey[i].stop = 'window'; break; }
        if (!jobs.has(job.name)) jobs.set(job.name, { ...job, key_index: i });
      }
      if (!perKey[i].stop) perKey[i].stop = 'end';
    } catch (e) {
      perKey[i].error = String(e?.message || e).slice(0, 160);
      unknown.push(`key ${i} listing failed after ${seen} jobs: ${perKey[i].error}`);
    }
    perKey[i].listed = seen;
    perKey[i].pages = Math.ceil(seen / pageSize) || 1;
    perKey[i].ms += Date.now() - t0;
    log(`[gemini-ledger] key ${i} (${perKey[i].key}): ${seen} jobs, ${perKey[i].pages} pages, ${(perKey[i].ms / 1000).toFixed(1)} s, stopped: ${perKey[i].stop || 'error'}`);
  }
  return { jobs, perKey, unknown };
}

// ─────────────────────────────────────────── records (what our stores say about a job)

/**
 * A record is one store's statement about one Gemini job:
 *   { store, id, status, collected, open, pages, created_at }
 * collected = the output was read by its owner; open = the owner still means to read it.
 * A record that is neither says the job is over without its output having been read.
 */
const COLLECTED_BATCH_STATUSES = new Set(['saved', 'completed_with_errors', 'collected']);
const OPEN_BATCH_STATUSES = new Set(['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING', 'submitted']);
/** Deliberate discards: the output was refused on purpose (generation guard, reset). Not a loss claim. */
const DISCARDED_BATCH_STATUSES = new Set(['superseded']);

export function recordFromBatchJob(r) {
  const collected = r.results_collected === true || COLLECTED_BATCH_STATUSES.has(r.status);
  return {
    store: 'batch_jobs', id: r.id || String(r._id), status: r.status, type: r.type || null,
    collected, discarded: !collected && DISCARDED_BATCH_STATUSES.has(r.status),
    open: !collected && OPEN_BATCH_STATUSES.has(r.status),
    pages: r.page_count || r.page_ids?.length || 0, created_at: r.created_at || null,
  };
}

/**
 * translate_batch_runs: the chained lane keeps the in-flight job at `round.job.name` and past
 * rounds in `rounds[]` ({ job, outcome, reason, collected_at }); the seam lane at
 * `translate_job.name` / `repair_job.name`. A past round was READ unless its strike reason is
 * the job's own Gemini state ("job JOB_STATE_CANCELLED") — then the run gave up on the job
 * without reading it, and if Gemini now says SUCCEEDED that is the loss this ledger looks for.
 */
export function recordsFromRun(run, wanted) {
  const out = [];
  const id = run.id || String(run._id);
  const name = run.round?.job?.name;
  if (name && wanted.has(name)) {
    out.push({ name, store: 'translate_batch_runs', id, status: `round:${run.phase}`, collected: false,
      open: run.phase === 'round_submitted', pages: run.round?.pages?.length || 0, created_at: run.round?.job?.submitted_at || null });
  }
  for (const x of run.rounds || []) {
    if (!x?.job || !wanted.has(x.job)) continue;
    const unread = x.outcome === 'strike' && /^job (JOB|BATCH)_STATE_/.test(String(x.reason || ''));
    out.push({ name: x.job, store: 'translate_batch_runs', id, status: `rounds:${x.outcome || 'ok'}${unread ? ` (${x.reason})` : ''}`,
      collected: !unread, open: false, pages: x.pages || 0, created_at: x.submitted_at || null });
  }
  for (const [field, kind] of [['translate_job', 'translate'], ['repair_job', 'repair']]) {
    const n = run[field]?.name;
    if (!n || !wanted.has(n)) continue;
    const seamOpen = run.phase === `${kind}_submitted`;
    const seamRead = ['written', 'shadow_complete', 'complete'].includes(run.phase)
      || (kind === 'translate' && ['repair_submitted', 'repair_ready'].includes(run.phase));
    out.push({ name: n, store: 'translate_batch_runs', id, status: `seam:${run.phase}`, collected: seamRead, open: seamOpen,
      pages: run.page_count || 0, created_at: run[field]?.submitted_at || null });
  }
  return out;
}

/**
 * Lanes that keep their own job collection, keyed `gemini_name` (found 2026-10-08 by asking every
 * collection whose name holds job, batch or run for a `batches/…` name). A new lane that stores its jobs
 * elsewhere shows up as unknown_to_db until it is added here or meters its job by name.
 */
export const LANE_STORES = ['embed_batch_jobs', 'enrich_batch_jobs', 'concept_abstract_jobs'];

/** A lane job row: { gemini_name, status } with submitted|collecting|collected|embedded|failed. */
export function recordFromLaneJob(store, r) {
  return { store, id: String(r._id), status: r.status, collected: r.status === 'collected' || r.status === 'embedded',
    open: ['submitted', 'collecting', 'pending', 'processing'].includes(r.status),
    pages: r.page_count || r.lines || 0, created_at: r.submitted_at || r.created_at || null };
}

/**
 * gemini_usage (either store), keyed as jobForUsageId() reads it.
 * A usage row proves the output was READ only when it carries tokens or a success status — a
 * placeholder closed at $0 with status 'failed' (closeUsagePlaceholder) proves the opposite.
 */
export function recordFromUsage(r) {
  const read = r.status === 'success' || (r.output_tokens || 0) > 0;
  const placeholder = ['submitted', 'pending'].includes(r.status);
  return { store: `gemini_usage:${r.store || 'supabase'}`, id: r.batch_job_id, status: r.status, collected: read,
    open: !read && placeholder, pages: r.page_count || 0, created_at: r.timestamp || null, endpoint: r.endpoint || null };
}

/**
 * Display names safe to use as a usage-id prefix: the per-book lanes name their jobs
 * `embed-<id>` / `ep-<format>-<n>-<id>`. Anything with a space, slash or wildcard is left out
 * rather than quoted into a filter.
 */
const PER_BOOK_SAFE = /^[\w.-]+$/;
export const perBookPrefixes = (jobs) => [...new Set(jobs.map((j) => j.displayName).filter((d) => d && PER_BOOK_SAFE.test(d)))];

/**
 * The listed job a usage row belongs to. A usage id is the job's Gemini name, `name#run`, its
 * display name, a batch_jobs id, or `<display name>:<book id>`. The last is the embedding
 * lanes' one-row-per-book metering (embed-gemini.mjs, eval/embed-format/batch-embed.mjs); their
 * collect step closes those rows, so a closed one proves the output was read.
 */
export function jobForUsageId(batchJobId, byKey) {
  const id = String(batchJobId || '');
  const colon = id.lastIndexOf(':');
  return byKey.get(id) || byKey.get(id.split('#')[0]) || (colon > 0 ? byKey.get(id.slice(0, colon)) : undefined);
}

// ─────────────────────────────────────────── classification (pure)

/**
 * Classify every listed job against what our stores say about it.
 * `records`: Map<geminiName, record[]>. Returns { findings, counts, ok_counts }.
 */
export function classifyLedger({ jobs, records, now = new Date(), graceH = IN_FLIGHT_GRACE_H }) {
  const t = ms(now);
  const findings = [];
  const ok = { collected: 0, in_flight: 0, discarded: 0, twin_collected: 0, alive_tracked: 0, dead: 0, empty: 0 };
  for (const job of jobs.values()) {
    const recs = records.get(job.name) || [];
    const ended = ms(job.endTime || job.updateTime || job.createTime);
    const sinceEndH = (t - ended) / HOUR;
    const pages = Math.max(0, ...recs.map((r) => r.pages || 0)) || job.request_count || 0;
    const base = { name: job.name, display_name: job.displayName || null, state: job.state, created: job.createTime || null,
      ended: job.endTime || null, since_end_h: r1(sinceEndH), pages, key_index: job.key_index ?? null,
      records: recs.map((r) => `${r.store}:${r.status}`).slice(0, 4),
      ...(job.carried ? { carried: true } : {}), ...(job.output_gone ? { output_gone: true } : {}) };
    if (SUCCEEDED.has(job.state)) {
      if (recs.some((r) => r.collected)) { ok.collected++; continue; }
      if (recs.some((r) => r.discarded)) { ok.discarded++; continue; }
      // A second submission of a job whose twin WAS collected: paid twice (section 4's waste),
      // but nothing was lost, so it is counted here and not raised as a finding.
      if (recs.length && recs.every((r) => r.twin) && recs.some((r) => r.twin_collected)) { ok.twin_collected++; continue; }
      if (recs.some((r) => r.open) && sinceEndH < graceH) { ok.in_flight++; continue; }
      const cls = recs.length ? 'succeeded_uncollected' : 'unknown_to_db';
      // `actionable` is always true: a finding stands until collected or discarded (#6333).
      findings.push({ ...base, class: cls, actionable: true });
    } else if (ALIVE.has(job.state)) {
      if (recs.length && !recs.some((r) => r.open || r.collected)) {
        findings.push({ ...base, class: 'terminal_while_alive', actionable: true, since_end_h: null });
      } else ok.alive_tracked++;
    } else {
      ok.dead++;
    }
  }
  findings.sort((a, b) => (a.since_end_h ?? -1) - (b.since_end_h ?? -1));
  return { findings, counts: countFindings(findings), ok_counts: ok, listed: jobs.size };
}

export const LEDGER_CLASSES = ['succeeded_uncollected', 'unknown_to_db', 'terminal_while_alive'];

/** Per-class jobs and pages, all and actionable. Re-run after pages are filled in. */
export function countFindings(findings) {
  const counts = {};
  for (const c of LEDGER_CLASSES) {
    const f = findings.filter((x) => x.class === c);
    const a = f.filter((x) => x.actionable);
    counts[c] = { jobs: f.length, pages: f.reduce((s, x) => s + x.pages, 0), actionable: a.length, actionable_pages: a.reduce((s, x) => s + x.pages, 0) };
  }
  return counts;
}

/**
 * Positive control, every run: three fake jobs injected into the REAL listing and records, one
 * per class, must each come back as that class (and actionable). If any does not, the section
 * is broken and the run is UNKNOWN.
 */
export function ledgerPositiveControl({ jobs, records, now = new Date() }) {
  const t = ms(now);
  const iso = (h) => new Date(t - h * HOUR).toISOString();
  const fakes = [
    ['batches/__pc_uncollected__', { state: 'JOB_STATE_SUCCEEDED', createTime: iso(6), endTime: iso(5) },
      [{ store: 'batch_jobs', status: 'cancelled', collected: false, open: false, pages: 7 }], 'succeeded_uncollected'],
    ['batches/__pc_unknown__', { state: 'JOB_STATE_SUCCEEDED', createTime: iso(6), endTime: iso(5) }, [], 'unknown_to_db'],
    ['batches/__pc_alive__', { state: 'JOB_STATE_RUNNING', createTime: iso(2) },
      [{ store: 'batch_jobs', status: 'failed', collected: false, open: false, pages: 3 }], 'terminal_while_alive'],
  ];
  const j2 = new Map(jobs);
  const r2 = new Map(records);
  for (const [name, job, recs] of fakes) { j2.set(name, { name, ...job }); r2.set(name, recs); }
  const res = classifyLedger({ jobs: j2, records: r2, now });
  const got = Object.fromEntries(fakes.map(([name, , , want]) => {
    const f = res.findings.find((x) => x.name === name);
    return [want, f && f.class === want && f.actionable ? 'fired' : (f?.class || 'missed')];
  }));
  return { ok: Object.values(got).every((v) => v === 'fired'), ...got };
}

// ─────────────────────────────────────────── readers

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const add = (map, name, rec) => { if (!map.has(name)) map.set(name, []); map.get(name).push(rec); };

/**
 * Every record our stores hold about the listed jobs. Mongo stores first; gemini_usage only for
 * SUCCEEDED jobs no Mongo store calls collected (that is where one-off scripts and evals meter
 * their jobs — by Gemini name, `name#…`, or their own display name).
 * `supabaseUsage(names)` is injected so the reader stays testable; it must THROW when unreadable.
 */
export async function readLedgerRecords(db, jobs, { supabaseUsage = null, log = () => {} } = {}) {
  const records = new Map();
  const names = [...jobs.keys()];
  const wanted = new Set(names);
  for (const ch of chunk(names, 2000)) {
    const rows = await db.collection('batch_jobs').find(
      { $or: [{ job_name: { $in: ch } }, { gemini_job_name: { $in: ch } }] },
      { projection: { id: 1, job_name: 1, gemini_job_name: 1, status: 1, results_collected: 1, type: 1, page_count: 1, created_at: 1 } },
    ).toArray();
    for (const r of rows) {
      for (const n of new Set([r.job_name, r.gemini_job_name])) if (n && wanted.has(n)) add(records, n, recordFromBatchJob(r));
    }
    const runs = await db.collection('translate_batch_runs').find(
      { $or: [{ 'round.job.name': { $in: ch } }, { 'rounds.job': { $in: ch } }, { 'translate_job.name': { $in: ch } }, { 'repair_job.name': { $in: ch } }] },
      { projection: { id: 1, phase: 1, page_count: 1, 'round.job': 1, 'round.pages': 1, rounds: 1, 'translate_job.name': 1, 'translate_job.submitted_at': 1, 'repair_job.name': 1, 'repair_job.submitted_at': 1 } },
    ).toArray();
    for (const run of runs) for (const rec of recordsFromRun(run, wanted)) add(records, rec.name, rec);
    for (const store of LANE_STORES) {
      const lane = await db.collection(store).find({ gemini_name: { $in: ch } },
        { projection: { gemini_name: 1, status: 1, submitted_at: 1, created_at: 1 } }).toArray();
      for (const r of lane) add(records, r.gemini_name, recordFromLaneJob(store, r));
    }
  }
  // A lane row written BEFORE the job was created at Gemini carries no gemini_name if the
  // submitter died in between; it is keyed by the display name it gave the job (#6333).
  const byDisplay = new Map();
  for (const j of jobs.values()) if (j.displayName && !records.has(j.name)) byDisplay.set(j.displayName, j.name);
  for (const ch of chunk([...byDisplay.keys()], 2000)) {
    for (const store of LANE_STORES) {
      const lane = await db.collection(store).find({ _id: { $in: ch } },
        { projection: { gemini_name: 1, status: 1, submitted_at: 1, created_at: 1 } }).toArray();
      for (const r of lane) if (!r.gemini_name) add(records, byDisplay.get(r._id), recordFromLaneJob(store, r));
    }
  }
  // Usage rows, only where no Mongo store says the job was read.
  const need = [...jobs.values()].filter((j) => SUCCEEDED.has(j.state) && !(records.get(j.name) || []).some((r) => r.collected || r.discarded));
  if (need.length) {
    const byKey = new Map(); // usage batch_job_id candidates → gemini name
    for (const j of need) {
      byKey.set(j.name, j.name);
      if (j.displayName) byKey.set(j.displayName, j.name);
      for (const r of records.get(j.name) || []) if (r.store === 'batch_jobs' && r.id) byKey.set(r.id, j.name);
    }
    const keysList = [...byKey.keys()];
    for (const ch of chunk(keysList, 2000)) {
      const rows = await db.collection('gemini_usage').find({ batch_job_id: { $in: ch } },
        { projection: { _id: 0, batch_job_id: 1, status: 1, output_tokens: 1, page_count: 1, endpoint: 1, timestamp: 1 } }).toArray();
      for (const r of rows) add(records, byKey.get(r.batch_job_id), recordFromUsage({ ...r, store: 'mongo' }));
    }
    // Per-book rows, `<display name>:<book id>`. A range per prefix (';' follows ':') stays on the index.
    const prefixes = perBookPrefixes(need);
    for (const ch of chunk(prefixes, 50)) {
      const rows = await db.collection('gemini_usage').find({ $or: ch.map((p) => ({ batch_job_id: { $gte: `${p}:`, $lt: `${p};` } })) },
        { projection: { _id: 0, batch_job_id: 1, status: 1, output_tokens: 1, page_count: 1, endpoint: 1, timestamp: 1 } }).toArray();
      for (const r of rows) add(records, jobForUsageId(r.batch_job_id, byKey), recordFromUsage({ ...r, store: 'mongo' }));
    }
    if (supabaseUsage) {
      const rows = await supabaseUsage(keysList, need.map((j) => j.name), prefixes);
      for (const r of rows) {
        const name = jobForUsageId(r.batch_job_id, byKey);
        if (name) add(records, name, recordFromUsage({ ...r, store: 'supabase' }));
      }
    }
    log(`[gemini-ledger] usage lookup for ${need.length} finished jobs no Mongo store calls collected`);
  }
  // Twins: a job no store names, whose display name carries the id of a row that holds a
  // DIFFERENT Gemini job — the same work submitted twice (measured 2026-10-08: bulk-reocr-local
  // `reocr-<book>-<jobId>` and chained `tbc-<book>-<runId>-r<n>` resubmissions).
  const orphans = [...jobs.values()].filter((j) => SUCCEEDED.has(j.state) && !records.has(j.name) && j.displayName);
  const bjIds = new Map();
  const runIds = new Map();
  for (const j of orphans) {
    const t = twinIdsFromDisplayName(j.displayName);
    if (t.batchJobId) bjIds.set(t.batchJobId, j.name);
    if (t.runId) runIds.set(t.runId, j.name);
  }
  for (const ch of chunk([...bjIds.keys()], 2000)) {
    const rows = await db.collection('batch_jobs').find({ id: { $in: ch } },
      { projection: { id: 1, status: 1, results_collected: 1, job_name: 1, gemini_job_name: 1, page_count: 1 } }).toArray();
    for (const r of rows) {
      const rec = recordFromBatchJob(r);
      add(records, bjIds.get(r.id), { ...rec, store: 'twin:batch_jobs', status: `twin ${r.status} (${r.job_name || r.gemini_job_name || 'no name'})`,
        collected: false, open: false, discarded: false, twin: true, twin_collected: rec.collected });
    }
  }
  for (const ch of chunk([...runIds.keys()], 2000)) {
    const runs = await db.collection('translate_batch_runs').find({ id: { $in: ch } }, { projection: { id: 1, phase: 1 } }).toArray();
    for (const r of runs) {
      add(records, runIds.get(r.id), { store: 'twin:translate_batch_runs', id: r.id, status: `twin run ${r.phase}`, collected: false,
        open: false, pages: 0, twin: true, twin_collected: ['complete', 'parked', 'written', 'shadow_complete'].includes(r.phase) });
    }
  }
  return records;
}

/** Row ids a pipeline display name carries: `<prefix>-<24-hex book>-<batch_jobs.id>`, `tbc-<book>-<run id>-r<n>`. */
export function twinIdsFromDisplayName(displayName) {
  const s = String(displayName || '');
  const run = s.match(/^tbc-[0-9a-f]{24}-(tbc_[a-z0-9]+_[a-z0-9]+)-r\d+$/);
  if (run) return { runId: run[1] };
  const bj = s.match(/^(?:pipeline-ocr|reocr|ocr|translate|translation|images)-[0-9a-f]{24}-([A-Za-z0-9_-]{8,})$/);
  return bj ? { batchJobId: bj[1] } : {};
}

/**
 * Supabase gemini_usage rows for exact ids, plus `name#…` prefixes (the chained lane meters
 * `${jobName}#${runId}`) and `<display name>:…` prefixes (the per-book lanes). Throws on any non-OK response — an unreadable store is UNKNOWN.
 */
export function makeSupabaseUsageReader({ url, key, fetchImpl = fetch }) {
  if (!url || !key) return null;
  const select = 'batch_job_id,status,output_tokens,page_count,endpoint,timestamp';
  const get = async (qs) => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const r = await fetchImpl(`${url}/rest/v1/gemini_usage?${qs}&select=${select}&order=id.asc`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok && r.status !== 206) throw new Error(`Supabase gemini_usage read failed (${r.status})`);
      const rows = await r.json();
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  };
  return async (ids, names, prefixes = []) => {
    const rows = [];
    const enc = (s) => encodeURIComponent(`"${String(s).replace(/"/g, '')}"`);
    for (const ch of chunk(ids, 80)) rows.push(...await get(`batch_job_id=in.(${ch.map(enc).join(',')})`));
    for (const ch of chunk(names, 40)) {
      const ors = ch.map((n) => `batch_job_id.like.${n}#*`).join(',');
      rows.push(...await get(`or=(${encodeURIComponent(ors)})`));
    }
    for (const ch of chunk(prefixes, 40)) {
      const ors = ch.map((p) => `batch_job_id.like.${p}:*`).join(',');
      rows.push(...await get(`or=(${encodeURIComponent(ors)})`));
    }
    return rows;
  };
}

/** REST and SDK name the same states BATCH_STATE_* and JOB_STATE_*. */
const normState = (st) => String(st || 'UNKNOWN').replace(/^BATCH_STATE_/, 'JOB_STATE_');

/**
 * Gemini's own tally for one job: { state, requests, ok, failed, displayName, createTime, endTime },
 * or { missing: true } on a 404, or null when it could not be read. Raw REST, because the SDK's
 * Job drops `metadata.batchStats` (measured 2026-10-08, @google/genai batches.get).
 */
export async function readBatchStats(name, key, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
      headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 404) return { missing: true };
    if (!r.ok) return null;
    const md = (await r.json())?.metadata || {};
    const st = md.batchStats || null;
    return {
      state: normState(md.state), displayName: md.displayName || null, createTime: md.createTime || null, endTime: md.endTime || null,
      has_stats: Boolean(st), requests: Number(st?.requestCount || 0), ok: Number(st?.successfulRequestCount || 0), failed: Number(st?.failedRequestCount || 0),
    };
  } catch { return null; }
}

/** Every request failed or was cancelled: Gemini billed nothing and there is nothing to collect. */
export function isEmptyJob(stats) {
  return Boolean(stats && stats.has_stats && stats.state === 'JOB_STATE_SUCCEEDED' && stats.requests > 0 && stats.ok === 0 && stats.failed === stats.requests);
}

/**
 * Read Gemini's tally for every finished finding (batches.get is free), fill in the request
 * count where our stores gave no page count, and take out of the findings every job whose
 * requests ALL failed: it is counted in `ok.empty`. A job whose tally cannot be read stays a
 * finding. Bounded so a big backlog cannot stall the run; past the budget, findings stay.
 * Mutates `res` ({ findings, ok_counts }) and returns { asked, empty }.
 */
export async function settleFindings(res, keys, { budget = 400, fetchImpl = fetch } = {}) {
  let asked = 0;
  const kept = [];
  const empty = [];
  for (const f of res.findings) {
    const key = keys[f.key_index ?? 0];
    if (f.class === 'terminal_while_alive' || f.output_gone || !key || asked >= budget) { kept.push(f); continue; }
    asked++;
    const stats = await readBatchStats(f.name, key, { fetchImpl });
    if (stats && !stats.missing) {
      f.requests = stats.requests; f.requests_ok = stats.ok;
      if (!f.pages && stats.requests) { f.pages = stats.requests; f.pages_from = 'gemini requestCount'; }
    }
    if (isEmptyJob(stats)) empty.push(f); else kept.push(f);
  }
  res.findings = kept;
  res.ok_counts.empty = (res.ok_counts.empty || 0) + empty.length;
  return { asked, empty: empty.map((f) => ({ name: f.name, display_name: f.display_name, requests: f.requests })) };
}

/**
 * Findings of an earlier run whose jobs are no longer in this run's listing (the hourly walk
 * stops at 72 h): each is asked about by name and put back among the jobs, so the stores are
 * read for it again and it stays a finding until one of them says collected or discarded.
 *   - Gemini still holds it      → the job as Gemini describes it now, `carried`
 *   - Gemini answers 404         → kept as it was last seen, `carried` + `output_gone`: the
 *                                  result can no longer be collected, only discarded on purpose
 *   - Gemini could not be asked  → kept as it was last seen, `carried`
 * Mutates `jobs` (Map<name, job>); returns the number carried.
 */
export async function carryForwardFindings(prevFindings, jobs, keys, { now = new Date(), maxDays = CARRY_FORWARD_DAYS, fetchImpl = fetch } = {}) {
  let carried = 0;
  for (const f of prevFindings || []) {
    if (!f?.name || jobs.has(f.name) || f.class === 'terminal_while_alive') continue;
    const last = ms(f.ended || f.created);
    if (Number.isFinite(last) && ms(now) - last > maxDays * 24 * HOUR) continue;
    const key = keys[f.key_index ?? 0];
    const stats = key ? await readBatchStats(f.name, key, { fetchImpl }) : null;
    const seen = { name: f.name, displayName: f.display_name || '', state: 'JOB_STATE_SUCCEEDED', createTime: f.created, endTime: f.ended, key_index: f.key_index ?? null, carried: true };
    if (stats?.missing) jobs.set(f.name, { ...seen, output_gone: true });
    else if (stats) jobs.set(f.name, { ...seen, displayName: stats.displayName || seen.displayName, state: stats.state, createTime: stats.createTime || seen.createTime, endTime: stats.endTime || seen.endTime });
    else jobs.set(f.name, seen);
    carried++;
  }
  return carried;
}
