#!/usr/bin/env node
/**
 * Dry-run recovery count (#6276 part 4) — READ-ONLY. How many batch_jobs rows we marked
 * cancelled / failed / expired, never collected, still have a retrievable result at Gemini?
 *
 * PRIOR ART: scripts/workers/batch-collector.mjs "Recovery sweep" (recovery_checked_at) — re-checks
 * only `failed` rows with `job_name`, 20 per hour, 7 days back, and RE-COLLECTS them (writes page
 * text); it never looks at `cancelled`/`expired` or at `gemini_job_name`, and it stamps every row
 * it asks about. scripts/batch/collect-batch-results.mjs --abandon — marks old rows abandoned on
 * the ASSUMPTION that output expired; this script measures that assumption instead. Reuses
 * probeBatchJob() (scripts/workers/lib/batch-reconcile.mjs) for the per-key batches.get.
 *
 * For each named, uncollected cancelled/failed/expired row created in the last --days (default 60):
 *   batches.get on every key (free) → still exists? state? output attached (dest file / inline)?
 *   and, for a result FILE, files.get (free) → is the file itself still there?
 * Reports by month: rows, pages, exists at Gemini, SUCCEEDED, SUCCEEDED with output retrievable.
 * Writes NOTHING to any store and makes no generation call. --jsonl=PATH writes the per-row
 * verdicts to a local file (put it under $JOB_SCRATCH, not the repo).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/batch-recovery-count.mjs [--days=60] [--jsonl=/path/out.jsonl] [--markdown]
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { probeBatchJob } from '../workers/lib/batch-reconcile.mjs';
import { geminiKeys } from './paid-vs-got.mjs';

const args = process.argv.slice(2);
const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const DAYS = Number(arg('days') || 60);
const JSONL = arg('jsonl');
const MARKDOWN = args.includes('--markdown');

const keys = geminiKeys();
if (!keys.length || !process.env.MONGODB_URI) { console.error('GEMINI_API_KEY* and MONGODB_URI required — could not measure'); process.exit(2); }
// usage-ok: batches.get and files.get only — metadata reads, no generation, nothing billed.
const clients = keys.map((apiKey) => new GoogleGenAI({ apiKey }));

/** Is the result file still downloadable-in-principle? files.get is metadata only (free). */
async function fileState(fileName, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, {
    headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20_000) });
  if (r.status === 404) return 'gone';
  if (!r.ok) return `error ${r.status}`;
  const j = await r.json();
  return j.state === 'ACTIVE' || !j.state ? 'present' : String(j.state).toLowerCase();
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30_000 });
await client.connect();
let exit = 0;
try {
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const since = new Date(Date.now() - DAYS * 86400e3);
  const rows = await db.collection('batch_jobs').find({
    created_at: { $gte: since },
    status: { $in: ['cancelled', 'failed', 'expired'] },
    results_collected: { $ne: true },
    $or: [{ job_name: { $exists: true, $nin: [null, ''] } }, { gemini_job_name: { $exists: true, $nin: [null, ''] } }],
  }, { projection: { id: 1, status: 1, type: 1, page_count: 1, page_ids: 1, created_at: 1, job_name: 1, gemini_job_name: 1, error: 1, cancel_reason: 1 } })
    .sort({ created_at: 1 }).toArray();
  console.error(`${rows.length} named, uncollected cancelled/failed/expired rows since ${since.toISOString().slice(0, 10)}; probing each on ${keys.length} keys…`);

  const out = JSONL ? fs.createWriteStream(JSONL) : null;
  const byMonth = new Map();
  const bump = (m, k, pages) => { const e = byMonth.get(m); e[k].rows++; e[k].pages += pages; };
  let n = 0;
  let unmeasurable = 0;
  for (const r of rows) {
    const name = r.job_name || r.gemini_job_name;
    const pages = r.page_count || r.page_ids?.length || 0;
    const month = r.created_at.toISOString().slice(0, 7);
    if (!byMonth.has(month)) {
      byMonth.set(month, Object.fromEntries(['rows', 'exists', 'not_found', 'unmeasurable', 'succeeded', 'output_attached', 'retrievable']
        .map((k) => [k, { rows: 0, pages: 0 }])));
    }
    bump(month, 'rows', pages);
    const probe = await probeBatchJob(name, clients, keys);
    const v = { id: r.id, status: r.status, type: r.type, pages, created_at: r.created_at, name, reason: r.cancel_reason || r.error || null, verdict: probe.verdict };
    if (probe.verdict === 'exists') {
      bump(month, 'exists', pages);
      const j = probe.sdkJob;
      v.state = j.state;
      v.output = j.dest?.fileName ? 'file' : j.dest?.inlinedResponses?.length ? 'inline' : null;
      if (j.state === 'JOB_STATE_SUCCEEDED') {
        bump(month, 'succeeded', pages);
        if (v.output) {
          bump(month, 'output_attached', pages);
          v.file = v.output === 'file' ? await fileState(j.dest.fileName, keys[probe.keyIndex]) : 'inline';
          if (v.file === 'present' || v.file === 'inline') bump(month, 'retrievable', pages);
        }
      }
    } else if (probe.verdict === 'not_found') bump(month, 'not_found', pages);
    else { bump(month, 'unmeasurable', pages); unmeasurable++; }
    out?.write(JSON.stringify(v) + '\n');
    if (++n % 50 === 0) console.error(`  ${n}/${rows.length}`);
  }
  out?.end();

  const cols = ['rows', 'exists', 'not_found', 'unmeasurable', 'succeeded', 'output_attached', 'retrievable'];
  const total = Object.fromEntries(cols.map((k) => [k, { rows: 0, pages: 0 }]));
  for (const e of byMonth.values()) for (const k of cols) { total[k].rows += e[k].rows; total[k].pages += e[k].pages; }
  const cell = (c) => `${c.rows.toLocaleString('en-US')} (${c.pages.toLocaleString('en-US')} pp)`;
  if (MARKDOWN) {
    console.log(`| month | ${cols.join(' | ')} |`);
    console.log(`|---|${cols.map(() => '---:').join('|')}|`);
    for (const [m, e] of [...byMonth].sort()) console.log(`| ${m} | ${cols.map((k) => cell(e[k])).join(' | ')} |`);
    console.log(`| **all** | ${cols.map((k) => `**${cell(total[k])}**`).join(' | ')} |`);
  } else {
    for (const [m, e] of [...byMonth].sort()) console.log(`${m}  ${cols.map((k) => `${k} ${cell(e[k])}`).join('  ')}`);
    console.log(`all      ${cols.map((k) => `${k} ${cell(total[k])}`).join('  ')}`);
  }
  console.error('\nREAD-ONLY: no batch_jobs row was changed and nothing was re-collected.');
  if (unmeasurable) { console.error(`${unmeasurable} row(s) unmeasurable (a key errored) — the count is a lower bound. Exit 2.`); exit = 2; }
} finally {
  await client.close().catch(() => {});
}
process.exit(exit);
