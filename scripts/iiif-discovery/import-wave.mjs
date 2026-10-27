#!/usr/bin/env node
/**
 * Acquisition-wave importer (#7343): tier survey survivors → live manifest fetch →
 * the gate → one hidden, held, archive-blocked book per candidate.
 *
 *   candidate-tier-survey.ts --emit-tiers ABC  →  <label>-survivors-ABC.jsonl.gz  →  THIS
 *
 * `--manifest-only` writes the book with its true page count and
 * `pages_state: manifest_only`, and NO page docs (lazy pages, #7346): pages are
 * created by materializePages() when the book is opened, released or published.
 * Without it, each book is materialized right after insert.
 *
 * The per-book rules live in scripts/iiif-discovery/lib/wave-import.mjs. Runs on a
 * box, never through a Vercel route (import-cost-and-egress.md).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/iiif-discovery/import-wave.mjs \
 *     --survivors=$JOB_SCRATCH/survey/import_candidates-survivors-ABC.jsonl.gz \
 *     --tiers=B --max-year=1849 --manifest-only \
 *     --campaign=acquisition-wave-2026-10-lazy \
 *     --hold-reason=manifest-only-lazy-pages --hold-issue=7343 \
 *     --hold-release="Derek or the #6553 planner releases them for OCR" \
 *     --checkpoint=$JOB_SCRATCH/import.jsonl [--sample=200] [--limit=N] [--dry-run]
 *
 * Options:
 *   --survivors=<file>      survey survivor file (.jsonl or .jsonl.gz); required
 *   --tiers=B[C]            tiers to import (tier A is never taken from here)
 *   --verdicts=NEW,OTHER_ED survey verdicts to import (unresolved partial/spelling/unkeyed rows are not)
 *   --max-year=N            only dated rows with year <= N
 *   --sources=a,b / --exclude-sources=a,b
 *   --sample=N              N rows spread across source × language cells (a test batch)
 *   --limit=N               at most N rows this run
 *   --min-canvases=N        skip manifests with fewer canvases (default 5)
 *   --host-rps=N            per-host request cap (default 1; lower-only against DOMAIN_LIMITS)
 *   --ia-concurrency=N      parallel manifest fetches for archive.org hosts (default 4)
 *   --host-concurrency=N    parallel manifest fetches for every other host (default 1). The
 *                           per-host rate cap still holds; this only helps a host that answers slowly.
 *   --park-after=N          park a host after N identical 401/403 in a row (default 2)
 *   --checkpoint=<file>     one JSON line per row; rows already in it are not retried
 *                           (except errors, and fetch_failed on a host that was parked)
 *   --retry-failed          also retry rows whose manifest fetch failed (5xx, timeout)
 *   --stop-file=<file>      stop cleanly when this file exists
 *   --dry-run               fetch and count, write nothing
 */

import { createReadStream, existsSync, appendFileSync, readFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { getScriptClient } from '../lib/mongo.mjs';
import { rateLimitedFetch, capDomainLimit } from '../lib/iiif-utils.mjs';
import { importCandidate, HostParker, hostOf, spreadSample } from './lib/wave-import.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; })
);
const list = v => (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : []);
const SURVIVORS = args.survivors;
const TIERS = new Set(list(args.tiers || 'B'));
const VERDICTS = new Set(list(args.verdicts || 'NEW,OTHER_ED'));
const MAX_YEAR = args['max-year'] ? parseInt(args['max-year'], 10) : null;
const SOURCES = new Set(list(args.sources));
const EXCLUDE = new Set(list(args['exclude-sources']));
const SAMPLE = parseInt(args.sample, 10) || 0;
const LIMIT = parseInt(args.limit, 10) || Infinity;
const MIN_CANVASES = args['min-canvases'] ? parseInt(args['min-canvases'], 10) : 5;
const HOST_RPS = parseFloat(args['host-rps']) || 1;
const IA_CONC = parseInt(args['ia-concurrency'], 10) || 4;
const HOST_CONC = parseInt(args['host-concurrency'], 10) || 1;
const PARK_AFTER = parseInt(args['park-after'], 10) || 2;
const CHECKPOINT = args.checkpoint || null;
const STOP_FILE = args['stop-file'] || null;
const DRY_RUN = !!args['dry-run'];
const RETRY_FAILED = !!args['retry-failed'];
const MANIFEST_ONLY = !!args['manifest-only'];
const CAMPAIGN = args.campaign;
const HOLD = { reason: args['hold-reason'], release: args['hold-release'], issue: parseInt(args['hold-issue'], 10) || null };

if (!SURVIVORS) { console.error('--survivors=<file> is required'); process.exit(2); }
if (TIERS.has('A')) { console.error('tier A is not imported from here (job acq-wave-a-7343 owns it)'); process.exit(2); }
if (!CAMPAIGN || !HOLD.reason || !HOLD.release) { console.error('--campaign, --hold-reason and --hold-release are required: a wave book is born held'); process.exit(2); }

// ── Rows ─────────────────────────────────────────────────────────────────────
async function readSurvivors(file) {
  const input = file.endsWith('.gz') ? createReadStream(file).pipe(createGunzip()) : createReadStream(file);
  const out = [];
  for await (const line of createInterface({ input })) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (!TIERS.has(r.tier) || !VERDICTS.has(r.verdict) || !r.dated) continue;
    if (MAX_YEAR != null && !(typeof r.year === 'number' && r.year <= MAX_YEAR)) continue;
    if (SOURCES.size && !SOURCES.has(r.source)) continue;
    if (EXCLUDE.has(r.source)) continue;
    if (!r.manifest_url) continue; // needs a source adapter, not this importer
    out.push(r);
  }
  return out;
}

const done = new Set();
if (CHECKPOINT && existsSync(CHECKPOINT)) {
  for (const line of readFileSync(CHECKPOINT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.outcome === 'fetch_failed' && r.parked) continue; // the host was walled: retry on a later run
    if (r.outcome === 'error') continue; // an unexpected throw (e.g. a slug race): retry
    if (r.outcome === 'fetch_failed' && RETRY_FAILED) continue;
    done.add(r.manifest_url);
  }
}

let rows = (await readSurvivors(SURVIVORS)).filter(r => !done.has(r.manifest_url));
// Within each host, the higher tier goes first: --tiers=B,C imports a host's B rows before its C rows.
rows.sort((a, b) => String(a.tier).localeCompare(String(b.tier)));
if (SAMPLE) rows = spreadSample(rows, SAMPLE);
if (rows.length > LIMIT) rows = rows.slice(0, LIMIT);
console.log(`[import-wave] ${rows.length} rows (tiers ${[...TIERS].join('')}, ${done.size} already in checkpoint) → ${MANIFEST_ONLY ? 'MANIFEST-ONLY' : 'with pages'}, hidden, held (${HOLD.reason}), campaign ${CAMPAIGN}${DRY_RUN ? ', DRY RUN' : ''}`);

// ── Fetch ────────────────────────────────────────────────────────────────────
const isIa = host => /(^|\.)archive\.org$/.test(host);
const capped = new Set();
async function fetchManifest(url) {
  const host = hostOf(url);
  if (!capped.has(host)) { capDomainLimit(host, isIa(host) ? Math.max(HOST_RPS, 2) : HOST_RPS); capped.add(host); }
  const buf = await rateLimitedFetch(url, { timeout: 60_000, maxMs: 180_000, retries: 2, userAgent: 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)' });
  return JSON.parse(buf.toString('utf8'));
}

// ── Run ──────────────────────────────────────────────────────────────────────
const { client, db } = await getScriptClient({ noTimeout: true });
const parker = new HostParker(PARK_AFTER);
const tally = {};
const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };
let processed = 0, pagesDeclared = 0, stopping = false;
const started = Date.now();

const byHost = new Map();
for (const r of rows) {
  const h = hostOf(r.manifest_url);
  if (!byHost.has(h)) byHost.set(h, []);
  byHost.get(h).push(r);
}

async function candidateFor(r) {
  return db.collection('import_candidates').findOne({ manifest_url: r.manifest_url, source: r.source });
}

async function one(host, r) {
  // Every Mongo call for the row sits inside the try: a network timeout costs this
  // row (an `error`, retried on the next run), never the whole run.
  let res, c = null;
  try {
    c = await candidateFor(r);
    if (!c) res = { outcome: 'not_candidate', reason: 'row not found' };
    else res = await importCandidate(db, c, { fetchManifest, language: r.language, campaign: CAMPAIGN, hold: HOLD, manifestOnly: MANIFEST_ONLY, minCanvases: MIN_CANVASES, dryRun: DRY_RUN });
  } catch (e) {
    res = { outcome: 'error', error: String(e?.message ?? e).slice(0, 300) };
  }
  const parked = parker.note(host, res.http_status);
  if (res.outcome === 'fetch_failed' && !parked && !DRY_RUN && c) {
    await db.collection('import_candidates').updateOne({ _id: c._id, status: { $in: ['discovered', 'failed'] } }, { $set: { status: 'failed', skip_reason: `Manifest fetch failed: ${res.error}` } }).catch(() => {});
  }
  bump(`${res.outcome}`);
  if (res.pages && (res.outcome === 'imported' || res.outcome === 'materialized')) pagesDeclared += res.pages;
  processed++;
  if (CHECKPOINT) appendFileSync(CHECKPOINT, JSON.stringify({ at: new Date().toISOString(), tier: r.tier, source: r.source, language: r.language, year: r.year, manifest_url: r.manifest_url, ...res, ...(res.outcome === 'fetch_failed' ? { parked } : {}) }) + '\n');
  if (processed % 1000 === 0) {
    const rate = processed / ((Date.now() - started) / 1000);
    console.log(`[import-wave] ${processed}/${rows.length} ${rate.toFixed(2)}/s ${JSON.stringify(tally)} pages=${pagesDeclared} parked=${JSON.stringify(Object.fromEntries(parker.parked))}`);
  }
}

async function hostLane(host, queue) {
  const workers = Array.from({ length: isIa(host) ? IA_CONC : HOST_CONC }, async () => {
    while (queue.length && !stopping) {
      if (STOP_FILE && existsSync(STOP_FILE)) { stopping = true; break; }
      if (parker.isParked(host)) {
        // Every remaining row on a walled host is recorded once, as parked, and retried on a later run.
        while (queue.length) {
          const r = queue.shift();
          bump('host_parked');
          if (CHECKPOINT) appendFileSync(CHECKPOINT, JSON.stringify({ at: new Date().toISOString(), tier: r.tier, source: r.source, language: r.language, year: r.year, manifest_url: r.manifest_url, outcome: 'fetch_failed', parked: true, error: parker.parked.get(host) }) + '\n');
        }
        break;
      }
      await one(host, queue.shift());
    }
  });
  await Promise.all(workers);
}

await Promise.all([...byHost.entries()].map(([h, q]) => hostLane(h, q)));
console.log(`[import-wave] done${stopping ? ' (stop file)' : ''}: ${processed} processed, ${JSON.stringify(tally)}, pages declared ${pagesDeclared}, parked ${JSON.stringify(Object.fromEntries(parker.parked))}, ${((Date.now() - started) / 60000).toFixed(1)} min`);
await client.close();
