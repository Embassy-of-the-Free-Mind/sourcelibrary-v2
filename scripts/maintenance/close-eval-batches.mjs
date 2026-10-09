#!/usr/bin/env node
// PRIOR ART: scripts/lib/eval-batch-registry.mjs closeEvalBatch() is the write this calls; nothing in
// scripts/maintenance or scripts/audit ended an `external_eval` row (looked: `git grep external_eval`).
// scripts/audit/paid-vs-got.mjs reports these rows and deliberately does not change them.
/**
 * close-eval-batches.mjs — end the `external_eval` registration of eval Batch jobs whose results
 * were demonstrably downloaded (#5897).
 *
 * Who runs it: a person, after the daily paid-vs-got audit flags eval rows, or after an eval script
 * that predates closeEvalBatch() (or crashed between download and close). Dry-run by default.
 *
 * Proof of download, per row, is a collected `gemini_usage` row (Supabase or Mongo) whose
 * batch_job_id is the Gemini job name, status `success`, with output tokens: those tokens are
 * summed from the downloaded responses, so the row cannot exist without the download. A row with
 * no such proof is left open and listed with Gemini's own state for it (batches.get on every key,
 * free); close it only with --evidence once the results files have been seen.
 *
 *   node --env-file=.env.production.local scripts/maintenance/close-eval-batches.mjs            # dry run
 *   … --apply                                         # close the proven rows
 *   … --apply --evidence 'plate-=PR #5850, captions.json on main'   # also close rows whose id starts with the prefix
 *
 * Run it where every GEMINI_API_KEY* is set (Hetzner): a job asked on too few keys reads NOT_FOUND.
 * Writes only batch_jobs rows in status `external_eval`. No worker selects on the `collected` status
 * it sets; the next paid-vs-got run stops counting the row as open.
 */
import { withMongo } from '../lib/mongo.mjs';
import { closeEvalBatch, EVAL_OPEN } from '../lib/eval-batch-registry.mjs';

const APPLY = process.argv.includes('--apply');
const MANUAL = process.argv.flatMap((a, i, v) => (a === '--evidence' && v[i + 1] ? [v[i + 1]] : []))
  .map((s) => { const k = s.indexOf('='); if (k < 1) throw new Error(`--evidence wants '<id prefix>=<what proves it>', got ${s}`); return [s.slice(0, k), s.slice(k + 1)]; });
const KEYS = [...new Set(Object.entries(process.env).filter(([k, v]) => k.startsWith('GEMINI_API_KEY') && v).map(([, v]) => v))];
const clean = (v) => (v || '').replace(/\\n/g, '').trim();

/** Every usage row for these job names, from both stores, in two queries (a per-row lookup scans Mongo 50 times). */
async function usageByJob(db, names) {
  const url = clean(process.env.SUPABASE_URL) || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set — the primary usage store is unreadable');
  const rows = [];
  for (let i = 0; i < names.length; i += 40) {
    const list = names.slice(i, i + 40).map((n) => `"${n}"`).join(',');
    const r = await fetch(`${url}/rest/v1/gemini_usage?batch_job_id=in.(${encodeURIComponent(list)})&select=batch_job_id,status,input_tokens,output_tokens,cost_usd,completed_at,endpoint`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: '0-999' }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok && r.status !== 206) throw new Error(`Supabase gemini_usage read failed (${r.status})`);
    const got = await r.json();
    if (got.length >= 1000) throw new Error('Supabase: 1,000 usage rows for 40 jobs — refusing a truncated read');
    rows.push(...got);
  }
  rows.push(...await db.collection('gemini_usage').find({ batch_job_id: { $in: names } }).toArray());
  const by = new Map();
  for (const u of rows) by.set(u.batch_job_id, [...(by.get(u.batch_job_id) || []), u]);
  return by;
}

async function geminiState(name) {
  const seen = new Set();
  for (const k of KEYS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, { headers: { 'x-goog-api-key': k } });
    if (r.ok) { const j = await r.json(); return (j.metadata || j).state || 'UNKNOWN'; }
    seen.add(r.status);
  }
  return `NOT_FOUND on ${KEYS.length} key(s) (${[...seen].join(',')})`;
}

await withMongo(async (db) => {
  const rows = await db.collection('batch_jobs').find({ status: EVAL_OPEN }).sort({ created_at: 1 }).toArray();
  console.log(`${rows.length} ${EVAL_OPEN} row(s); ${KEYS.length} Gemini key(s); ${APPLY ? 'APPLY' : 'dry run'}`);
  const usageOf = await usageByJob(db, rows.map((r) => r.gemini_job_name || r.job_name).filter(Boolean));
  let proven = 0, manual = 0, left = 0, closed = 0;
  for (const row of rows) {
    const name = row.gemini_job_name || row.job_name;
    const id = row.id || String(row._id);
    const ageH = ((Date.now() - new Date(row.created_at).getTime()) / 3600e3).toFixed(1);
    const usage = usageOf.get(name) || [];
    const hit = usage.find((u) => u.status === 'success' && Number(u.output_tokens) > 0);
    const byHand = MANUAL.find(([prefix]) => id.startsWith(prefix));
    let evidence = null, usageSet = {};
    if (hit) {
      proven++;
      evidence = `gemini_usage row: success, ${hit.input_tokens} in / ${hit.output_tokens} out, completed ${hit.completed_at || '?'}${hit.endpoint ? ` (${hit.endpoint})` : ''}`;
      usageSet = { cost_usd: Number(hit.cost_usd) || 0, input_tokens: Number(hit.input_tokens) || 0, output_tokens: Number(hit.output_tokens) || 0 };
    } else if (byHand) { manual++; evidence = `by hand: ${byHand[1]}`; }
    if (!evidence) {
      left++;
      console.log(`  LEFT OPEN  ${ageH.padStart(6)} h  ${id}  — no collected usage row; Gemini says ${name ? await geminiState(name) : 'unnamed'}`);
      continue;
    }
    if (APPLY) closed += await closeEvalBatch(db, name, { evidence, usage: usageSet });
    console.log(`  ${APPLY ? 'closed     ' : 'would close'} ${ageH.padStart(6)} h  ${id}  — ${evidence}`);
  }
  console.log(`proven by usage row: ${proven}; by --evidence: ${manual}; left open: ${left}; rows changed: ${closed}`);
}, { timeoutMs: 240_000 });
