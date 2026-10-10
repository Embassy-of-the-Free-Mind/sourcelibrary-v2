#!/usr/bin/env node
/**
 * Resolve the Gemini-side findings of `paid-vs-got.mjs --collection-only` (#6333): save every
 * finished-but-uncollected job's output first, then end each one on purpose.
 *
 * PRIOR ART: scripts/maintenance/recover-uncollected-batches.mjs — downloads and WRITES page
 * text for `batch_jobs` rows in a loss status (#6276); it selects from batch_jobs, so it cannot
 * see a job no row names (the enrich / embedding lanes, chained translate rounds, evals, one-off
 * scripts), which is most of what the hourly check reports. Its staged write path is still the
 * one to use for OCR / translation rows it can select. scripts/maintenance/close-eval-batches.mjs
 * — closes `external_eval` rows already registered; it cannot register one. This script starts
 * from Gemini's listing (the same classification the audit runs) and covers every store.
 *
 * Subcommands (nothing writes production without --apply):
 *   download   list the window, classify, and save each finding's result to
 *              $OUT/results/<job>.jsonl + $OUT/manifest.jsonl (bytes, sha256, responses) and
 *              $OUT/findings.json. Free: batches.list / batches.get / file download only.
 *              --jobs=<batches/a,…> also saves those named jobs if they are in the window.
 *              Run it FIRST: results at Gemini do not last forever.
 *   status     the manifest against Gemini's own request tally and our stores, read-only.
 *   discard    --match=<regex on display name> | --jobs=<batches/a,batches/b>  --reason="…" [--issue=N]
 *              ends each job through discardBatchJob() (scripts/lib/end-batch-job.mjs): refused
 *              without a reason, without Gemini's word, or — for a job with paid responses —
 *              without the saved result named in the manifest.
 *   collected  --match=… | --jobs=…  --evidence="…" [--issue=N]
 *              for a file-only job whose owner DID read the output (an eval that reported from
 *              files): registers it (registerEvalBatch) and closes it (closeEvalBatch) with the
 *              evidence and the saved result's path. Never use it for output nobody read.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/resolve-batch-findings.mjs download --out=/data/scratch/sl/batch-recover-NNNN
 *   … status --out=DIR
 *   … discard --out=DIR --match='^tbc-' --reason="superseded: the lane resubmitted these rounds" --issue=6333 [--apply]
 *   … collected --out=DIR --match='^tattva-6184-' --evidence="#6184 comment 2026-10-07T13:39Z" --issue=6184 [--apply]
 *
 * Undo: a discard is `status: 'superseded'` + `discard` on a batch_jobs row (`status_before_discard`
 * holds the old status; an inserted row has type 'discard_record'). The saved result stays on disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { geminiKeys } from '../audit/paid-vs-got.mjs';
import {
  listAllBatches, readLedgerRecords, classifyLedger, makeSupabaseUsageReader, settleFindings, readBatchStats,
} from '../lib/gemini-batch-ledger.mjs';
import { discardBatchJob } from '../lib/end-batch-job.mjs';
import { registerEvalBatch, closeEvalBatch } from '../lib/eval-batch-registry.mjs';

const BY = 'scripts/maintenance/resolve-batch-findings.mjs';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const args = process.argv.slice(2);
const cmd = args[0];
const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const APPLY = args.includes('--apply');
const OUT = arg('out');
const clean = (v) => (v || '').replace(/\\n/g, '').trim();

if (!['download', 'status', 'discard', 'collected'].includes(cmd) || !OUT) {
  console.error('usage: resolve-batch-findings.mjs download|status|discard|collected --out=DIR [...]  (see the file header)');
  process.exit(2);
}

const manifestPath = path.join(OUT, 'manifest.jsonl');
/** Latest manifest row per job (a re-run appends). */
function readManifest() {
  if (!fs.existsSync(manifestPath)) throw new Error(`${manifestPath} not found — run download first`);
  const byJob = new Map();
  for (const l of fs.readFileSync(manifestPath, 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); byJob.set(r.job, r); }
  return [...byJob.values()];
}

async function hashFile(file) {
  const h = crypto.createHash('sha256');
  let lines = 0;
  for await (const c of fs.createReadStream(file)) { h.update(c); for (const b of c) if (b === 10) lines++; }
  return { sha256: h.digest('hex'), responses: lines, bytes: fs.statSync(file).size };
}

async function download(db, keys) {
  // usage-ok: batches.list / batches.get / result download only — nothing generated, nothing billed.
  const clients = keys.map((apiKey) => new GoogleGenAI({ apiKey }));
  const now = new Date();
  const windowH = Number(arg('window-h') || 168);
  const listing = await listAllBatches(clients, { keys, sinceMs: now.getTime() - windowH * 3600e3, log: (m) => console.error(m) });
  if (listing.unknown.length) { console.error(`listing incomplete: ${listing.unknown.join('; ')}`); process.exitCode = 2; }
  const supabaseUsage = makeSupabaseUsageReader({ url: clean(process.env.SUPABASE_URL) || 'https://ykhxaecbbxaaqlujuzde.supabase.co', key: clean(process.env.SUPABASE_SERVICE_ROLE_KEY) });
  const records = await readLedgerRecords(db, listing.jobs, { supabaseUsage, log: (m) => console.error(m) });
  const res = classifyLedger({ jobs: listing.jobs, records, now });
  // --jobs: also save these named jobs, whatever the ledger says of them (e.g. an eval row the
  // DB-side check calls open while a usage row says it was read).
  for (const name of (arg('jobs') || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    if (res.findings.some((f) => f.name === name)) continue;
    const j = listing.jobs.get(name);
    if (!j) { console.error(`--jobs: ${name} is not in the ${windowH} h listing`); process.exitCode = 1; continue; }
    res.findings.push({ name, display_name: j.displayName || null, class: 'named', created: j.createTime || null, ended: j.endTime || null,
      key_index: j.key_index, records: (records.get(name) || []).map((r) => `${r.store}:${r.status}`), pages: 0 });
  }
  // Save BEFORE settling: an all-cancelled job's result file is still the evidence that it was empty.
  fs.mkdirSync(path.join(OUT, 'results'), { recursive: true });
  const man = fs.createWriteStream(manifestPath, { flags: 'a' });
  const tally = { findings: res.findings.length, saved: 0, already: 0, failed: 0, alive: 0 };
  for (const f of res.findings) {
    if (f.class === 'terminal_while_alive') { tally.alive++; continue; }
    const file = path.join(OUT, 'results', `${f.name.replace(/^batches\//, '')}.jsonl`);
    const row = { job: f.name, display_name: f.display_name, class: f.class, created: f.created, ended: f.ended, records: f.records, key_index: f.key_index, file };
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) { row.note = 'already on disk'; tally.already++; } else {
        const j = await clients[f.key_index].batches.get({ name: f.name });
        row.model = j.model;
        if (j.dest?.fileName) {
          row.output = 'file';
          const resp = await fetch(`${API}/${j.dest.fileName}:download?alt=media`, { headers: { 'x-goog-api-key': keys[f.key_index] } });
          if (!resp.ok) throw new Error(`download ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
          await pipeline(Readable.fromWeb(/** @type {any} */ (resp.body)), fs.createWriteStream(`${file}.part`));
          fs.renameSync(`${file}.part`, file);
        } else {
          const inl = j.dest?.inlinedResponses || j.dest?.inlinedEmbedContentResponses;
          if (!inl?.length) throw new Error('SUCCEEDED with no output attached');
          row.output = 'inline';
          fs.writeFileSync(file, inl.map((x) => JSON.stringify(x)).join('\n') + '\n');
        }
        tally.saved++;
      }
      Object.assign(row, await hashFile(file));
    } catch (e) { row.error = String(e?.message || e).slice(0, 300); tally.failed++; }
    man.write(JSON.stringify(row) + '\n');
  }
  man.end();
  await new Promise((r) => man.on('finish', r));
  const settled = await settleFindings(res, keys);
  fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify({ at: now, window_h: windowH, listed: res.listed, ok: res.ok_counts, empty: settled.empty, findings: res.findings }, null, 1));
  console.log(JSON.stringify({ ...tally, empty_all_requests_failed: settled.empty.length, out: OUT }));
  if (tally.failed) process.exitCode = 1;
}

function selected(manifest) {
  const jobs = arg('jobs')?.split(',').map((s) => s.trim()).filter(Boolean);
  const match = arg('match') ? new RegExp(arg('match')) : null;
  if (!jobs && !match) throw new Error('--match=<regex on display name> or --jobs=<batches/…,…> is required');
  if (!jobs) return manifest.filter((m) => match.test(m.display_name || ''));
  // A named job with no manifest row (its output aged out before anyone saved it) can still be
  // discarded, if Gemini no longer holds it or it holds nothing paid; decideDiscard() refuses the rest.
  return jobs.map((name) => manifest.find((m) => m.job === name) || { job: name, display_name: null, error: 'not in the manifest' });
}

/** Gemini's word about one manifest row, in the shape decideDiscard() takes. */
async function askGemini(m, keys) {
  // The key that listed the job first; then every other key — "not found" needs all of them.
  const order = [...new Set([m.key_index ?? 0, ...keys.keys()])];
  let missing = 0;
  for (const i of order) {
    const stats = await readBatchStats(m.job, keys[i]);
    if (!stats) return { verdict: 'unmeasurable' };
    if (stats.missing) { missing++; continue; }
    return { verdict: 'exists', state: stats.state, requests: stats.requests, ok: stats.ok };
  }
  return missing === keys.length ? { verdict: 'not_found' } : { verdict: 'unmeasurable' };
}

async function main() {
  const keys = geminiKeys();
  if (!keys.length) throw new Error('no GEMINI_API_KEY* set');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  try {
    if (cmd === 'download') return await download(db, keys);
    const manifest = readManifest();
    if (cmd === 'status') {
      for (const m of manifest) {
        const g = await askGemini(m, keys);
        const rows = await db.collection('batch_jobs').find({ $or: [{ job_name: m.job }, { gemini_job_name: m.job }] }, { projection: { status: 1 } }).toArray();
        console.log(`${(m.display_name || '').slice(0, 52).padEnd(52)} ${m.job}  ok ${g.ok ?? '?'}/${g.requests ?? '?'}  rows: ${rows.map((r) => r.status).join(',') || '-'}  ${m.error ? `NOT SAVED: ${m.error}` : `${m.bytes} B`}`);
      }
      return;
    }
    const picked = selected(manifest);
    if (!picked.length) { console.error('no manifest row matches'); process.exitCode = 1; return; }
    const issue = arg('issue') ? Number(arg('issue')) : null;
    const tally = {};
    for (const m of picked) {
      const gemini = await askGemini(m, keys);
      const held = m.error || !m.sha256 ? null : { path: m.file, sha256: m.sha256, bytes: m.bytes };
      let r;
      if (cmd === 'discard') {
        r = await discardBatchJob(db, { name: m.job, displayName: m.display_name, reason: arg('reason'), by: BY, gemini, result: held,
          issue, model: m.model || null, pages: gemini.requests || m.responses || 0, createdAt: m.created, dryRun: !APPLY });
      } else {
        const evidence = arg('evidence');
        if (!evidence) throw new Error('collected: --evidence="…" (what shows the owner read the output) is required');
        if (!held) r = { action: 'refused', why: 'no saved result in the manifest' };
        else if (gemini.verdict !== 'exists' || !/SUCCEEDED/.test(gemini.state)) r = { action: 'refused', why: `Gemini: ${gemini.state || gemini.verdict}` };
        else if (!APPLY) r = { action: 'collected', why: 'dry run' };
        else {
          await registerEvalBatch(db, { jobName: m.job, id: `resolved-${m.job.replace(/^batches\//, '')}`, submittedBy: arg('submitted-by') || `unregistered (${m.display_name})`,
            model: m.model || null, pageCount: gemini.requests || m.responses || 0, submittedAt: m.created, issue,
            note: `registered after the fact by ${BY}: the submitter never recorded this job (#6333)` });
          const n = await closeEvalBatch(db, m.job, { evidence: `${evidence}; result saved at ${m.file} (sha256 ${m.sha256})` });
          r = { action: n ? 'collected' : 'refused', why: n ? 'registered and closed' : 'a row already names this job in another status' };
        }
      }
      tally[r.action] = (tally[r.action] || 0) + 1;
      console.log(`${r.action.padEnd(10)} ${(m.display_name || '').slice(0, 52).padEnd(52)} ${m.job}  ${r.why}`);
    }
    console.log(JSON.stringify({ ...tally, applied: APPLY }));
    if (!APPLY) console.error('(dry run — nothing written; add --apply)');
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
