#!/usr/bin/env node
/**
 * ocr-cost-snapshot.mjs — what one OCR page actually cost, per Gemini model, from the meter (#5983).
 *
 * PRIOR ART: scripts/audit/paid-vs-got.mjs — the daily ledger; its headline is "$ per 1,000 pages"
 * per LANE (ocr / translation / images), never per model, and it keeps no file. scripts/lib/
 * model-pricing.mjs PAGE_RATE_USD — one OCR rate (lite, measured 2026-09-04) and deliberately no
 * flash rate, because flash batch rows then held uncollected $0 placeholders (#4567). This script
 * reads only COLLECTED rows (status=success), so placeholders cannot enter, and writes a dated file
 * that the Pareto generator (build-ocr-pareto.mjs) reads at build time — the build never touches a
 * database.
 *
 * What it reads: gemini_usage in BOTH stores (Supabase primary, Mongo legacy; disjoint per row,
 * #3826), type=ocr, mode=batch, status=success, the last --days (default 30). Batch only, because
 * every bulk OCR goes through Batch (#5244); realtime is a reader waiting. Reads only. $0.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/eval/ocr-cost-snapshot.mjs            # prints, writes
 *   ... --days=60 --dry-run
 * Writes scripts/eval/results/ocr-cost/ocr-cost-<date>.json.
 * Fails (exit 2) when a store is unreadable: an unreadable meter is not a free engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const DAYS = Number(arg('days', 30));
const DRY = process.argv.includes('--dry-run');
const clean = v => (v || '').replace(/\\n/g, '').trim();

const until = new Date();
const since = new Date(until.getTime() - DAYS * 86400e3);

async function supabase() {
  const url = clean(process.env.SUPABASE_URL), key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — the primary usage store is unreadable');
  const out = [];
  for (let from = 0; ; from += 1000) {
    const qs = `type=eq.ocr&mode=eq.batch&status=eq.success&timestamp=gte.${since.toISOString()}&timestamp=lt.${until.toISOString()}`;
    const r = await fetch(`${url}/rest/v1/gemini_usage?${qs}&select=id,model,page_count,input_tokens,output_tokens,cost_usd&order=id.asc`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` }, signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok && r.status !== 206) throw new Error(`Supabase gemini_usage read failed (${r.status})`);
    const b = await r.json();
    out.push(...b);
    if (b.length < 1000) break;
  }
  return out;
}

async function mongo() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set — the legacy usage store is unreadable');
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  try {
    return await c.db(process.env.MONGODB_DB || 'bookstore').collection('gemini_usage')
      .find({ type: 'ocr', mode: 'batch', status: 'success', timestamp: { $gte: since, $lt: until } },
        { projection: { model: 1, page_count: 1, input_tokens: 1, output_tokens: 1, cost_usd: 1 } }).toArray();
  } finally { await c.close(); }
}

let supa, legacy;
try { [supa, legacy] = await Promise.all([supabase(), mongo()]); } catch (e) { console.error(`could not measure: ${e.message}`); process.exit(2); }

const by = new Map();
for (const [store, rows] of [['supabase', supa], ['mongo', legacy]]) for (const r of rows) {
  if (!r.model || !(r.page_count > 0)) continue;   // a row that names no pages cannot price a page
  const m = by.get(r.model) || { rows: 0, pages: 0, usd: 0, input_tokens: 0, output_tokens: 0, stores: {} };
  m.rows++; m.pages += r.page_count; m.usd += r.cost_usd || 0;
  m.input_tokens += r.input_tokens || 0; m.output_tokens += r.output_tokens || 0;
  m.stores[store] = (m.stores[store] || 0) + 1;
  by.set(r.model, m);
}

const models = {};
for (const [model, m] of [...by].sort()) models[model] = {
  usd_per_1k_pages: Math.round((m.usd / m.pages) * 1000 * 1000) / 1000,
  pages: m.pages, rows: m.rows, usd: Math.round(m.usd * 100) / 100,
  input_tokens_per_page: Math.round(m.input_tokens / m.pages), output_tokens_per_page: Math.round(m.output_tokens / m.pages),
  rows_by_store: m.stores,
};

const date = until.toISOString().slice(0, 10);
const out = {
  measure: 'metered OCR spend per page: collected Gemini Batch usage rows (gemini_usage, type=ocr, mode=batch, status=success)',
  window: { from: since.toISOString(), to: until.toISOString(), days: DAYS },
  generated_by: 'scripts/eval/ocr-cost-snapshot.mjs',
  issue: 5983,
  models,
};
for (const [m, v] of Object.entries(models)) console.log(`${m.padEnd(28)} $${v.usd_per_1k_pages.toFixed(3)} / 1,000 pages  (${v.pages.toLocaleString('en-US')} pages, $${v.usd}, ${v.input_tokens_per_page} in + ${v.output_tokens_per_page} out tokens/page)`);
if (DRY) process.exit(0);
const dir = path.join(__dirname, 'results', 'ocr-cost');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `ocr-cost-${date}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), file)}`);
