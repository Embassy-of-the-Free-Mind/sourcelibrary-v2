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
 * Run on Hetzner (paid Gemini is geo-blocked on the laptop):
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/translate-batch-worker.mjs --plan --book=<id>
 */
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { loadTranslationPrompts } from '../lib/translate-core.mjs';
import {
  planRun, startRun, advanceRun, estimateRunUsd, gateAllowsBook, RUNS_COLLECTION, TERMINAL_PHASES,
} from '../lib/translate-batch-seam.mjs';
import { budgetAllowsDispatchScoped } from '../lib/spend-guard.mjs';
import { logUsage, completeBatchUsage } from './lib/supabase-usage-logger.mjs';
import { syncPageUpdate } from './lib/supabase-page-writer.mjs';
import { probeBatchJob } from './lib/batch-reconcile.mjs';

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

function makeGeminiAdapter() {
  const clients = KEYS.map(apiKey => new GoogleGenAI({ apiKey }));
  let next = 0;
  return {
    /** Submit inline; rotate keys on quota (429/RESOURCE_EXHAUSTED) and batch-broken keys (#2455). */
    async submit({ model, requests, displayName }) {
      for (let attempt = 0; attempt < clients.length; attempt++) {
        const ki = (next + attempt) % clients.length;
        try {
          const job = await clients[ki].batches.create({ model, src: requests, config: { displayName } });
          next = ki + 1;
          return { name: job.name, keyIndex: ki };
        } catch (err) {
          const msg = err?.message || '';
          if (/429|RESOURCE_EXHAUSTED|quota|FAILED_PRECONDITION|Precondition check failed/.test(msg)) {
            console.log(`  key ${ki} refused the batch (${msg.slice(0, 80)}) — trying the next key`);
            continue;
          }
          throw err;
        }
      }
      throw new Error('ALL_KEYS_REFUSED_BATCH');
    },
    /** State + responses. Results come inline or as a file the SDK cannot download (batch-collector). */
    async fetch(name) {
      const probe = await probeBatchJob(name, clients, KEYS);
      // Never fail a run on a 404 or an unanswerable probe: a new job can lag, and a run
      // marked failed would abandon a job that is still billing (#4889). It stays open; --status shows it.
      if (probe.verdict !== 'exists') return { state: probe.verdict === 'not_found' ? 'NOT_FOUND' : 'UNMEASURABLE', responses: [] };
      const job = probe.sdkJob;
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
      const filter = arg('run') ? { id: arg('run') } : { phase: { $nin: TERMINAL_PHASES } };
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

main().catch((e) => { console.error(e); process.exit(1); });
