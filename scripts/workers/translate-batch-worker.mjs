#!/usr/bin/env node
/**
 * translate-batch-worker — translation on the Gemini Batch API with a seam-repair pass
 * (#4681; design measured in #4912 / #4973, arm Et). The logic lives in
 * scripts/lib/translate-batch-seam.mjs; this file is the CLI and the real Batch API adapter.
 *
 * OPT-IN ONLY. Nothing schedules this and the realtime translate-worker is unchanged: a book
 * goes through this lane only when an operator names it. Flipping the default is step 4 of
 * the plan (shadow run, blind judge, kill switch), not this file.
 *
 *   --plan    --book=ID                          FREE  blocks, seams, refusals, cost estimate
 *   --submit  --book=ID --approved-usd=X          PAID  submit the translate job (refuses if the
 *             [--shadow] [--limit=N]                    estimate exceeds X, or if neither the daily
 *                                                       dial nor an open scope envelope covers the book)
 *   --advance [--run=ID]                          PAID  poll open runs; when the translate job is
 *                                                       done, submit the repair job (~15% more);
 *                                                       when that is done, write the pages
 *   --status  [--book=ID]                         FREE  list runs
 *
 * --shadow keeps every draft and repair on the run document and writes NOTHING to pages —
 * the mode step 4's shadow run needs.
 *
 * CHAINED lane (scripts/lib/translate-batch-chained.mjs): production's loop one block per round,
 * seeded from Mongo, no repair pass — the design that replaces the seam repair above:
 *
 *   --chained --plan   --book=ID                        FREE  queue, blocks, estimate
 *   --chained --enrol  --books=ID,ID --approved-usd=X   PAID  enrol each book (X is PER BOOK) and
 *                                                             submit the first rounds in shared jobs
 *             [--pages-file=F] [--exclude-withheld]          F = JSON { bookId: [pageId] }: queue only
 *             [--dry-run] [--no-context]                     those pages (implies --exclude-withheld);
 *                                                             --dry-run plans + prices, enrols nothing;
 *                                                             --no-context: one request per page, no
 *                                                             seed, no adjacent OCR (#5497 arm B)
 *   --chained --enrol-auto [--limit=40] [--max-open=60] PAID  enrol what the gap-fill would want
 *             [--zero-only] [--min-pages=N]                     (AUTO_STATUSES), each approved at
 *             [--exclude-chinese] [--include-hidden]            pages × $0.0012, then submit;
 *             [--statuses=complete,images_complete]             (terminal only under an envelope)
 *             [--dry-run]                                       --dry-run lists candidates only
 *   --chained --tick                                    PAID  one pass: collect finished rounds,
 *                                                             write pages, submit next rounds
 *   --chained --loop [--interval=180] [--max-minutes=N] PAID  tick until every run is terminal
 *   --chained --status                                  FREE  open and recent chained runs
 *
 * Run on Hetzner (paid Gemini is geo-blocked on the laptop):
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/translate-batch-worker.mjs --plan --book=<id>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { loadTranslationPrompts, syncBookTranslationCounters } from '../lib/translate-core.mjs';
import {
  planRun, startRun, advanceRun, estimateRunUsd, gateAllowsBook, batchRequestToJsonlLine, RUNS_COLLECTION, TERMINAL_PHASES,
} from '../lib/translate-batch-seam.mjs';
import {
  enrolChainedRun, tickChained, submitRounds, selectAutoCandidates, planNextRound, estimateChainedUsd,
  MODE as CHAINED_MODE, TERMINAL_PHASES as CHAINED_TERMINAL, PHASE as CHAINED_PHASE,
} from '../lib/translate-batch-chained.mjs';
import { budgetAllowsDispatchScoped } from '../lib/spend-guard.mjs';
import { contentHash } from '../lib/translate-core.mjs';
import { logUsage, completeBatchUsage } from './lib/supabase-usage-logger.mjs';
import { syncPageUpdate } from './lib/supabase-page-writer.mjs';
import { probeBatchJob } from './lib/batch-reconcile.mjs';
import { startWorkerBeacon } from './lib/worker-heartbeat.mjs';

// Announce the code version this process loaded (#5442) — read by scripts/audit/worker-code-drift.mjs.
startWorkerBeacon(import.meta.url);

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const args = process.argv.slice(2);
const arg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;
const has = (name) => args.includes(`--${name}`);

// ── Real Batch API adapter ─────────────────────────────────────────────────
// Same key set as batch-collector (jobs are key-scoped, so polling must try every key).
const KEYS = [...new Set([
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean))];

const RETRYABLE = /429|RESOURCE_EXHAUSTED|quota|FAILED_PRECONDITION|Precondition check failed/;

/** Wait for an uploaded File API file to reach ACTIVE (batches.create against PROCESSING → 400). */
async function waitFileActive(client, fileName) {
  for (let i = 0; i < 30; i++) {
    let state;
    try { state = (await client.files.get({ name: fileName }))?.state; } catch { state = undefined; }
    if (state === 'ACTIVE') return;
    if (state === 'FAILED') throw new Error(`File API processing FAILED for ${fileName}`);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`File API file ${fileName} not ACTIVE after 60s`);
}

function makeGeminiAdapter() {
  const clients = KEYS.map(apiKey => new GoogleGenAI({ apiKey }));
  let next = 0;
  return {
    /**
     * Submit FILE-BASED: write the requests as JSONL, upload with one key, create the job with the
     * SAME key (a file is invisible to other keys — cross-key 404), delete the file once the job
     * holds it. Not inline: inline jobs on the Lite model were cancelled about every second job on
     * 2026-09-24 (whole jobs, or every request inside a SUCCEEDED job), the same class of
     * unreliability the OCR orchestrator recorded when it forced file-based input for Lite.
     * Rotate keys on quota (429/RESOURCE_EXHAUSTED) and batch-broken keys (#2455).
     */
    async submit({ model, requests, displayName }) {
      const tmp = path.join(os.tmpdir(), `sl-tbs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
      fs.writeFileSync(tmp, requests.map(r => JSON.stringify(batchRequestToJsonlLine(r))).join('\n') + '\n');
      try {
        for (let attempt = 0; attempt < clients.length; attempt++) {
          const ki = (next + attempt) % clients.length;
          const client = clients[ki];
          let file;
          try {
            file = await client.files.upload({ file: tmp, config: { mimeType: 'text/plain', displayName } });
            if (!file?.name) throw new Error(`upload returned no file name: ${JSON.stringify(file).slice(0, 120)}`);
            await waitFileActive(client, file.name);
            const job = await client.batches.create({ model, src: { fileName: file.name }, config: { displayName } });
            try { await client.files.delete({ name: file.name }); } catch { /* the sweeper in batch-collector reaps stale files */ }
            next = ki + 1;
            return { name: job.name, keyIndex: ki };
          } catch (err) {
            if (file?.name) { try { await client.files.delete({ name: file.name }); } catch { /* best effort */ } }
            const msg = err?.message || '';
            if (RETRYABLE.test(msg)) {
              console.log(`  key ${ki} refused the batch (${msg.slice(0, 80)}) — trying the next key`);
              continue;
            }
            throw err;
          }
        }
        throw new Error('ALL_KEYS_REFUSED_BATCH');
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* already gone */ }
      }
    },
    /** State + responses. Results come inline or as a file the SDK cannot download (batch-collector). */
    async fetch(name) {
      const probe = await probeBatchJob(name, clients, KEYS);
      // Never fail a run on a 404 or an unanswerable probe: a new job can lag, and a run
      // marked failed would abandon a job that is still billing (#4889). It stays open; --status shows it.
      if (probe.verdict !== 'exists') return { state: probe.verdict === 'not_found' ? 'NOT_FOUND' : 'UNMEASURABLE', responses: [] };
      const job = probe.sdkJob;
      // batchStats is the API's own per-request tally; read it rather than inferring from job state
      // (a SUCCEEDED job can carry failedRequestCount === requestCount).
      const st = job.batchStats;
      if (st && /SUCCEEDED|FAILED|CANCELLED|EXPIRED/.test(job.state || '')) {
        console.log(`  ${name}: ${job.state} — requests ${st.requestCount ?? '?'}, ok ${st.successfulRequestCount ?? 0}, failed ${st.failedRequestCount ?? 0}, pending ${st.pendingRequestCount ?? 0}`);
      }
      if (job.state !== 'JOB_STATE_SUCCEEDED') return { state: job.state, responses: [] };
      const fileName = job.dest?.fileName;
      if (fileName) {
        const resp = await fetch(`${GEMINI_API_BASE}/${fileName}:download?alt=media&key=${KEYS[probe.keyIndex]}`);
        if (!resp.ok) throw new Error(`result download failed (${resp.status})`);
        const text = await resp.text();
        return { state: job.state, responses: text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) };
      }
      return { state: job.state, responses: job.dest?.inlinedResponses || [] };
    },
  };
}

// ── Commands ───────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set — source .env.production.local first.'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  try {
    const bookId = arg('book');

    if (has('chained')) { await chained(db); return; }

    if (has('plan')) {
      if (!bookId) throw new Error('--plan needs --book=ID');
      const plan = await planRun(db, bookId, { limit: arg('limit') ? Number(arg('limit')) : undefined });
      if (!plan.ok) { console.log(`REFUSED: ${plan.reason}`); if (plan.excluded) console.log('excluded:', plan.excluded); return; }
      const prompts = await loadTranslationPrompts(db);
      const est = estimateRunUsd({ prompts, book: plan.book, blocks: plan.blocks, model: plan.model });
      console.log(`${plan.book.title?.slice(0, 70)} — ${plan.model}`);
      console.log(`  ${plan.pages.length} pages in ${plan.blocks.length} blocks → ${Math.max(0, plan.blocks.length - 1)} seams to repair`);
      console.log(`  block sizes: ${plan.blocks.map(b => b.length).join(' ')}`);
      console.log(`  excluded: ${JSON.stringify(plan.excluded)}`);
      console.log(`  estimate (batch price): translate $${est.translate_usd} + repair $${est.repair_usd} = $${est.total_usd}`);
      return;
    }

    if (has('submit')) {
      if (!bookId) throw new Error('--submit needs --book=ID');
      if (KEYS.length === 0) throw new Error('No GEMINI_API_KEY* set');
      const prompts = await loadTranslationPrompts(db);
      const res = await startRun(db, bookId, {
        gemini: makeGeminiAdapter(), logUsage, completeBatchUsage,
        // Scoped like the realtime worker: a closed daily dial still lets a book inside an open
        // envelope run (set-scope.mjs --books ... --budget), on that envelope's own meter.
        budgetAllows: async (d, label) => gateAllowsBook(await budgetAllowsDispatchScoped(d, label), bookId),
      }, { prompts, approvedUsd: arg('approved-usd'), shadow: has('shadow'), limit: arg('limit') ? Number(arg('limit')) : undefined });
      if (!res.ok) { console.log(`REFUSED: ${res.reason}`); process.exitCode = 2; }
      return;
    }

    if (has('advance')) {
      if (KEYS.length === 0) throw new Error('No GEMINI_API_KEY* set');
      const filter = arg('run') ? { id: arg('run') } : { phase: { $nin: TERMINAL_PHASES }, mode: { $ne: CHAINED_MODE } };
      const runs = await db.collection(RUNS_COLLECTION).find(filter).toArray();
      const deps = { gemini: makeGeminiAdapter(), logUsage, completeBatchUsage, syncPage: syncPageUpdate };
      for (const run of runs) {
        // Step until the run stops moving (a finished job can unlock the next phase in one go).
        for (let i = 0; i < 4; i++) {
          const r = await advanceRun(db, run, deps);
          console.log(`  ${run.book_id} ${run.id}: ${r.phase} — ${r.note}`);
          if (!r.advanced) break;
        }
      }
      if (runs.length === 0) console.log('No open runs.');
      return;
    }

    if (has('status')) {
      const runs = await db.collection(RUNS_COLLECTION).find(bookId ? { book_id: bookId } : {})
        .project({ id: 1, book_id: 1, phase: 1, shadow: 1, page_count: 1, write_counts: 1, estimate: 1, updated_at: 1 })
        .sort({ updated_at: -1 }).limit(50).toArray();
      for (const r of runs) console.log(`${r.id}  ${r.book_id}  ${r.phase}${r.shadow ? ' (shadow)' : ''}  ${r.page_count}pp  est $${r.estimate?.total_usd ?? '?'}  ${r.write_counts ? JSON.stringify(r.write_counts) : ''}`);
      return;
    }

    console.log('Usage: --plan | --submit | --advance | --status (see header)');
  } finally {
    await client.close();
  }
}

// ── Chained lane commands ──────────────────────────────────────────────────
async function chained(db) {
  // One adapter for the whole command: its key rotation remembers which key last refused, so a
  // loop does not pay a 429 on key 0 at every tick (it did, 2026-09-29 pilot log).
  const gemini = KEYS.length ? makeGeminiAdapter() : null;
  // One deps object per tick (or enrol pass), and the scoped gate is asked ONCE per object: the
  // gate re-sums every envelope's spend on each call (~3 s), which at 180 open runs made a tick
  // spend ~9 minutes gating (2026-09-30 load test). Each book is still checked against the
  // tick's gate; spend can pass the ceiling by at most one tick's rounds (~$0.3 at 180 runs).
  const deps = () => {
    let gate = null;
    return {
      gemini, logUsage, completeBatchUsage, syncPage: syncPageUpdate,
      budgetAllows: async (d, label) => {
        const bookId = label.split(' ').pop();
        gate ??= budgetAllowsDispatchScoped(d, 'translate-batch-chained tick');
        return gateAllowsBook(await gate, bookId);
      },
    };
  };

  if (has('plan')) {
    const bookId = arg('book');
    if (!bookId) throw new Error('--chained --plan needs --book=ID');
    const plan = await planRun(db, bookId, { limit: arg('limit') ? Number(arg('limit')) : undefined });
    if (!plan.ok) { console.log(`REFUSED: ${plan.reason}`); if (plan.excluded) console.log('excluded:', plan.excluded); return; }
    const prompts = await loadTranslationPrompts(db);
    const est = estimateChainedUsd({ prompts, book: plan.book, pages: plan.pages, model: plan.model });
    const first = planNextRound({ queue: plan.pages.map(p => ({ id: p.id, page_number: p.page_number, ocr_hash: p.ocr?.data ? contentHash(p.ocr.data) : '' })), cursor: 0, pending_single: [] }, new Map(plan.pages.map(p => [p.id, p])));
    console.log(`${plan.book.title?.slice(0, 70)} — ${plan.model}`);
    console.log(`  ${plan.pages.length} pages in ${plan.blocks.length} blocks → ${plan.blocks.length} rounds minimum (one block per round; fallbacks add rounds)`);
    console.log(`  block sizes: ${plan.blocks.map(b => b.length).join(' ')}`);
    console.log(`  first round: ${first?.kind} p${first?.pages?.[0]?.page_number}${first?.pages?.length > 1 ? `–${first.pages[first.pages.length - 1].page_number}` : ''}`);
    console.log(`  excluded: ${JSON.stringify(plan.excluded)}`);
    console.log(`  estimate (batch price, seeds included): $${est}`);
    return;
  }

  if (has('enrol-auto')) {
    // The scheduler's enrolment: up to --limit books the gap-fill would want (widened, see
    // AUTO_STATUSES), each approved at pages × AUTO_APPROVAL_USD_PER_PAGE. Enrolment spends
    // nothing by itself — every round is still gated by the dial or an envelope at submit — but an
    // open run IS stored spend, so --max-open caps how many this lane holds at once.
    const limit = Number(arg('limit') || 40);
    const maxOpen = Number(arg('max-open') || 60);
    const open = await db.collection(RUNS_COLLECTION).countDocuments({ mode: CHAINED_MODE, phase: { $nin: CHAINED_TERMINAL } });
    const room = Math.max(0, Math.min(limit, maxOpen - open));
    console.log(`  open chained runs: ${open} (max ${maxOpen}) → room for ${room}`);
    if (!room) return;
    const candidates = await selectAutoCandidates(db, {
      limit: room, zeroOnly: has('zero-only'), minPages: Number(arg('min-pages') || 0),
      visibleOnly: !has('include-hidden'), excludeChinese: has('exclude-chinese'),
      ...(arg('statuses') ? { statuses: arg('statuses').split(',').map((s) => s.trim()) } : {}),
    });
    const total = candidates.reduce((s, b) => s + b.approvedUsd, 0);
    for (const b of candidates) console.log(`  ${b.id}  ${String(b.language).slice(0, 12).padEnd(12)} ${b.pages_ocr}/${b.pages_count}pp tr ${b.pages_translated || 0}  ${b.pipeline_auto?.status}  approve $${b.approvedUsd}  ${String(b.title || '').slice(0, 60)}`);
    console.log(`  ${candidates.length} candidate(s), approvals total $${total.toFixed(2)}${has('dry-run') ? ' — DRY RUN, nothing enrolled' : ''}`);
    if (has('dry-run') || !candidates.length) return;
    if (KEYS.length === 0) throw new Error('No GEMINI_API_KEY* set');
    const prompts = await loadTranslationPrompts(db);
    const enrolled = [];
    for (const b of candidates) {
      const res = await enrolChainedRun(db, b.id, deps(), { prompts, approvedUsd: b.approvedUsd, submit: false });
      if (res.ok) { enrolled.push(res.run); continue; }
      console.log(`  ${b.id}: REFUSED — ${res.reason}`);
      // The selector read the counters, the enrol read the pages. When they disagree the counter
      // is stale (#3402); re-derive it so the book stops being selected every hour.
      if (res.reason === 'nothing-to-translate') await syncBookTranslationCounters(db, b.id);
    }
    const submitted = await submitRounds(db, enrolled, deps(), { prompts });
    for (const run of enrolled) console.log(`  ${run.book_id}: run ${run.id} est $${run.estimate} — ${submitted.get(run.id)?.note}`);
    return;
  }

  if (has('enrol')) {
    // Page-level targeting: --pages-file=FILE is JSON { bookId: [pageId, …] }; only those pages
    // are queued (still re-checked by selectPages), and it implies --exclude-withheld.
    const pagesByBook = arg('pages-file') ? JSON.parse(fs.readFileSync(arg('pages-file'), 'utf8')) : null;
    const excludeWithheld = has('exclude-withheld') || !!pagesByBook;
    const ids = (arg('books') || arg('book') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length && pagesByBook) ids.push(...Object.keys(pagesByBook));
    if (!ids.length) throw new Error('--chained --enrol needs --books=ID,ID (or --pages-file)');
    const target = (id) => ({ pageIds: pagesByBook ? (pagesByBook[id] || []) : null, excludeWithheld, noContext: has('no-context') });
    const prompts = await loadTranslationPrompts(db);
    if (has('dry-run')) {
      // FREE: the queue and estimate each enrol would make; nothing written, nothing sent.
      let pagesTotal = 0, usdTotal = 0;
      for (const id of ids) {
        const plan = await enrolChainedRun(db, id, deps(), { prompts, limit: arg('limit') ? Number(arg('limit')) : undefined, dryRun: true, ...target(id) });
        if (!plan.ok) { console.log(`  ${id}: REFUSED — ${plan.reason}`); continue; }
        const est = plan.estimate;
        pagesTotal += plan.pages.length; usdTotal += est;
        console.log(`  ${id}  ${String(plan.book.language).slice(0, 12).padEnd(12)} ${String(plan.pages.length).padStart(4)}pp  ${plan.model}  est $${est}  ${String(plan.book.title || '').slice(0, 50)}`);
      }
      console.log(`  DRY RUN: ${pagesTotal} pages, estimate $${usdTotal.toFixed(4)} — nothing enrolled`);
      return;
    }
    if (KEYS.length === 0) throw new Error('No GEMINI_API_KEY* set');
    // Enrol every book first, then submit their first rounds together: N books share ⌈N/50⌉ jobs.
    const enrolled = [];
    for (const id of ids) {
      const res = await enrolChainedRun(db, id, deps(), { prompts, approvedUsd: arg('approved-usd'), limit: arg('limit') ? Number(arg('limit')) : undefined, submit: false, ...target(id) });
      if (!res.ok) { console.log(`  ${id}: REFUSED — ${res.reason}`); process.exitCode = 2; }
      else { enrolled.push(res.run); console.log(`  ${id}: run ${res.run.id} est $${res.estimate}`); }
    }
    const submitted = await submitRounds(db, enrolled, deps(), { prompts });
    for (const run of enrolled) console.log(`  ${run.book_id}: ${submitted.get(run.id)?.note}`);
    return;
  }

  if (has('tick') || has('loop')) {
    if (KEYS.length === 0) throw new Error('No GEMINI_API_KEY* set');
    const prompts = await loadTranslationPrompts(db);
    const interval = Number(arg('interval') || 180) * 1000;
    const maxMinutes = Number(arg('max-minutes') || 0);
    const started = Date.now();
    for (;;) {
      const notes = await tickChained(db, deps(), { prompts, filter: arg('run') ? { id: arg('run') } : {} });
      const stamp = new Date().toISOString().slice(11, 19);
      for (const n of notes) console.log(`  ${stamp} ${n.book_id} ${n.run}: ${n.phase} — ${n.note}`);
      const open = await db.collection(RUNS_COLLECTION).countDocuments({ mode: CHAINED_MODE, phase: { $nin: CHAINED_TERMINAL } });
      console.log(`  ${stamp} open chained runs: ${open}`);
      if (!has('loop') || open === 0) return;
      if (maxMinutes && Date.now() - started > maxMinutes * 60000) { console.log('  --max-minutes reached; runs stay open for the next tick'); return; }
      await new Promise(r => setTimeout(r, interval));
    }
  }

  if (has('status')) {
    const runs = await db.collection(RUNS_COLLECTION).find({ mode: CHAINED_MODE, ...(arg('book') ? { book_id: arg('book') } : {}) })
      .project({ id: 1, book_id: 1, phase: 1, page_count: 1, cursor: 1, pending_single: 1, rounds: 1, counts: 1, estimate: 1, spent_est_usd: 1, strikes: 1, parked_reason: 1, updated_at: 1 })
      .sort({ updated_at: -1 }).limit(50).toArray();
    for (const r of runs) {
      const rounds = r.rounds || [];
      const lat = rounds.filter(x => x.submitted_at && x.collected_at).map(x => (new Date(x.collected_at) - new Date(x.submitted_at)) / 60000);
      const med = lat.length ? lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)].toFixed(1) : '?';
      console.log(`${r.id}  ${r.book_id}  ${r.phase}${r.parked_reason ? ` (${r.parked_reason})` : ''}  ${r.cursor}/${r.page_count} queued, ${(r.pending_single || []).length} pending single, ${rounds.length} rounds (median ${med} min)  est $${r.estimate} spent-est $${r.spent_est_usd}  ${JSON.stringify(r.counts || {})}`);
    }
    if (!runs.length) console.log('No chained runs.');
    return;
  }

  console.log('Usage: --chained --plan|--enrol|--tick|--loop|--status (see header)');
}

main().catch((e) => { console.error(e); process.exit(1); });
