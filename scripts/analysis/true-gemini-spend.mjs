#!/usr/bin/env node
/**
 * True Gemini spend — read every meter, from the right source per mode.
 *
 * WHY THIS EXISTS
 * ---------------
 * "Our spend doesn't add up" was investigated five times in one session and
 * resolved the same way every time: the **billing is coherent, the meters are
 * incomplete**. Anyone asking the question again would re-excavate it, because
 * no single query gives the answer. This script is that query.
 *
 * THE FOUR TRAPS IT EXISTS TO AVOID
 * ---------------------------------
 * 1. THERE ARE TWO `gemini_usage` STORES, and they are MUTUALLY EXCLUSIVE.
 *    `scripts/workers/lib/supabase-usage-logger.mjs` writes to Supabase and
 *    falls back to Mongo only when Supabase is absent or throws. Querying one
 *    gives roughly half. They must be SUMMED, never compared.
 *
 * 2. BATCH SPEND MUST COME FROM `batch_jobs`, NOT FROM `gemini_usage`.
 *    Batch rows are written as PLACEHOLDERS at submit time with
 *    `input_tokens: 0, cost_usd: 0` and were frequently never closed out
 *    (#3452 — 8,088 of 16,300 Mongo batch rows still carry zero tokens).
 *    `batch_jobs` carries real per-job `input_tokens`/`output_tokens`/`cost_usd`
 *    and, crucially, covers **Feb–Mar 2026, which neither `gemini_usage` store
 *    has a single row for** — and March was the PEAK batch month.
 *    So: batch from `batch_jobs`, realtime from the usage stores. Adding both
 *    stores' batch rows on top of `batch_jobs` DOUBLE-COUNTS.
 *
 * 3. PHASE NAMES DISAGREE BETWEEN THE STORES. Mongo writes
 *    `image_extraction`, Supabase writes `extract_images`, for the same phase.
 *    Normalised here on read (see PHASE_ALIASES) — fix at the writer eventually.
 *
 * 4. WORK THAT LOGS NOTHING AT ALL is reported as a named blind spot rather
 *    than silently omitted. `embed-gemini.mjs` calls `batchEmbedContents`
 *    directly (~4.9M embeddings); `ocr-correct-grounded.mjs` and
 *    `transliterate-greek.mjs` likewise. A meter that omits work silently is
 *    the failure this whole exercise was about.
 *
 * WHAT IT STILL CANNOT TELL YOU
 * -----------------------------
 * Google Cloud billing account `6845-9943-5879` covers TWO projects —
 * `Sourcelibrary` and `booksplit` — so the invoice is not all Gemini. There is
 * no BigQuery billing export (the API is not enabled), so the SKU split is
 * console-only. Compare this script's output to *Gemini-only* billed spend,
 * never to the invoice total.
 *
 * Run:
 *   node --env-file=.env.production.local scripts/analysis/true-gemini-spend.mjs
 *   node --env-file=.env.production.local scripts/analysis/true-gemini-spend.mjs --since=2026-04-01
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const SINCE = process.argv.find(a => a.startsWith('--since='))?.split('=')[1] || '2025-12-01';
const since = new Date(SINCE);

/** Mongo and Supabase name the same phase differently. Normalise on read. */
const PHASE_ALIASES = {
  image_extraction: 'extract_images',
  translate: 'translation',
};
const phase = (t) => PHASE_ALIASES[t] || t || 'unknown';

const money = (n) => ('$' + n.toFixed(2)).padStart(11);
const num = (n) => Number(n || 0);

async function realtimeFromMongo(db) {
  const rows = await db.collection('gemini_usage').aggregate([
    { $match: { timestamp: { $gte: since }, mode: { $ne: 'batch' } } },
    { $group: { _id: '$type', calls: { $sum: 1 },
      inTok: { $sum: { $ifNull: ['$input_tokens', 0] } },
      outTok: { $sum: { $ifNull: ['$output_tokens', 0] } },
      cost: { $sum: { $ifNull: ['$cost_usd', 0] } } } },
  ], { maxTimeMS: 300000 }).toArray();
  return rows.map(r => ({ phase: phase(r._id), calls: r.calls, inTok: r.inTok, outTok: r.outTok, cost: r.cost }));
}

async function realtimeFromSupabase(sb) {
  // Page explicitly WITH an order — an unordered .range() hits supabase-js's
  // silent 1,000-row cap and samples the query plan, not the population.
  const out = new Map();
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from('gemini_usage')
      .select('type,mode,cost_usd,input_tokens,output_tokens')
      .gte('timestamp', since.toISOString())
      .neq('mode', 'batch')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`supabase: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      const k = phase(r.type);
      const cur = out.get(k) || { phase: k, calls: 0, inTok: 0, outTok: 0, cost: 0 };
      cur.calls++; cur.inTok += num(r.input_tokens); cur.outTok += num(r.output_tokens); cur.cost += num(r.cost_usd);
      out.set(k, cur);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return [...out.values()];
}

async function batchFromBatchJobs(db) {
  const rows = await db.collection('batch_jobs').aggregate([
    { $match: { $or: [{ created_at: { $gte: since } }, { submitted_at: { $gte: since } }] } },
    { $group: { _id: '$type', jobs: { $sum: 1 },
      inTok: { $sum: { $ifNull: ['$input_tokens', 0] } },
      outTok: { $sum: { $ifNull: ['$output_tokens', 0] } },
      cost: { $sum: { $ifNull: ['$cost_usd', 0] } },
      pages: { $sum: { $ifNull: ['$completed_pages', 0] } },
      noTokens: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$input_tokens', 0] }, 0] }, 0, 1] } } } },
  ], { maxTimeMS: 300000 }).toArray();
  return rows.map(r => ({ phase: phase(r._id), jobs: r.jobs, inTok: r.inTok, outTok: r.outTok,
    cost: r.cost, pages: r.pages, noTokens: r.noTokens }));
}

function table(title, rows, keyLabel) {
  console.log(`\n=== ${title} ===`);
  console.log(`${'phase'.padEnd(22)}${keyLabel.padStart(9)}${'inTok'.padStart(15)}${'outTok'.padStart(15)}${'cost'.padStart(11)}`);
  let c = 0, i = 0, o = 0;
  for (const r of rows.sort((a, b) => b.cost - a.cost)) {
    c += r.cost; i += r.inTok; o += r.outTok;
    console.log(`${r.phase.padEnd(22)}${String(r.calls ?? r.jobs).padStart(9)}${String(r.inTok).padStart(15)}${String(r.outTok).padStart(15)}${money(r.cost)}`);
  }
  console.log(`${'SUBTOTAL'.padEnd(22)}${''.padStart(9)}${String(i).padStart(15)}${String(o).padStart(15)}${money(c)}`);
  return { cost: c, inTok: i, outTok: o };
}

async function main() {
  const mc = new MongoClient(process.env.MONGODB_URI);
  await mc.connect();
  const db = mc.db('bookstore');
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  );

  console.log(`True Gemini spend since ${SINCE}`);
  console.log('Batch from batch_jobs; realtime from BOTH gemini_usage stores (they are mutually exclusive).');

  const [mongoRt, supaRt, batch] = await Promise.all([
    realtimeFromMongo(db),
    realtimeFromSupabase(sb).catch(e => { console.warn(`  ! supabase unavailable: ${e.message}`); return []; }),
    batchFromBatchJobs(db),
  ]);

  const a = table('REALTIME — Mongo gemini_usage (fallback store)', mongoRt, 'calls');
  const b = table('REALTIME — Supabase gemini_usage (primary store)', supaRt, 'calls');
  const c = table('BATCH — batch_jobs (authoritative; gemini_usage batch rows are placeholders)', batch, 'jobs');

  const unclosed = batch.reduce((s, r) => s + (r.noTokens || 0), 0);
  const total = a.cost + b.cost + c.cost;

  console.log('\n════════ TOTAL RECORDED GEMINI SPEND ════════');
  console.log(`  realtime (Mongo)     ${money(a.cost)}`);
  console.log(`  realtime (Supabase)  ${money(b.cost)}`);
  console.log(`  batch (batch_jobs)   ${money(c.cost)}`);
  console.log(`  ${'TOTAL'.padEnd(20)} ${money(total)}`);

  console.log('\n──── KNOWN BLIND SPOTS (not in the total above) ────');
  console.log(`  · ${unclosed} batch jobs carry NO token data — submitted but never reconciled (#3452).`);
  console.log('  · embed-gemini.mjs logs nothing — ~4.9M embeddings across five tables.');
  console.log('  · ocr-correct-grounded.mjs and transliterate-greek.mjs log nothing.');
  console.log('  · cost_usd is COMPUTED from scripts/lib/model-pricing.mjs, which is NOT');
  console.log('    verified against Google\'s price list (#3576). Treat as an estimate.');
  console.log('\n  Compare against GEMINI-ONLY billed spend from the console, never the invoice');
  console.log('  total: billing account 6845-9943-5879 also covers the `booksplit` project,');
  console.log('  plus storage and egress. There is no BigQuery billing export.');

  await mc.close();
}

main().catch(e => { console.error(e); process.exit(1); });
