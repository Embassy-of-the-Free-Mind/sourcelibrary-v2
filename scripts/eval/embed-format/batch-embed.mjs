#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/embed-gemini.mjs `--batch/--collect` (#6161) — the
 * same asyncBatchEmbedContent request (production model, 768 dims, plain text,
 * no taskType) at the Batch price, but it upserts into `page_translations`,
 * which an eval must never write. scripts/eval/embed-format/embed.mjs — the
 * realtime arm runner for the 18K-page pools, 3072-d, at twice the price.
 * This is the Batch path for the 100K pool, into files only.
 *
 * batch-embed — document vectors for the #6170 follow-up, both formats.
 *
 *   submit  --dir D --format plain|prefix [--job-rows 20000] [--max-usd 9.5]
 *           Splits D/pool.jsonl into Batch jobs, asks the spend gate (label
 *           'embed-prefix-test') for each, records the job in D/jobs.json and
 *           a submit-time usage row per book (endpoint eval/embed-prefix-100k).
 *           At most --max-running (3) jobs in flight: more than ~3 embedding
 *           jobs per project get their requests cancelled (#5729).
 *   collect --dir D  Writes each finished job to D/vec-<format>/<job>.f32
 *           (768-d Float32, rows in the job's order) + <job>.rows.json, and
 *           closes its usage rows with billed tokens.
 *   status  --dir D
 *
 * Runs on the projects of keys 8 and 9, one job each at a time: the #5729
 * backfill holds TIER3's project and the concept lane holds key 3's.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { withMongo } from '../../lib/mongo.mjs';
import { budgetAllowsDispatchScoped } from '../../lib/spend-guard.mjs';
import { createThenDeleteInput, uploadBatchInputFile, streamBatchResponses } from '../../lib/gemini-batch-input-file.mjs';
import { estimateTextTokens, usdForTokens } from '../../lib/embedding-usage.mjs';
import { logUsage, completeBatchUsage } from '../../workers/lib/supabase-usage-logger.mjs';
import { arg, DOC_FORMS } from './common.mjs';

const CMD = process.argv[2];
const DIR = arg('--dir');
if (!DIR) { console.error('--dir D required'); process.exit(1); }
const MODEL = 'gemini-embedding-2-preview';
const DIMS = 768;
// One running job per PROJECT, 10K rows each: a second 20K-row job 429'd at
// create (enqueued-token limit), and a lone 20K-row job came back with every
// request "The operation was cancelled" (unbilled). #5729 ran 10K-page jobs. Keys 8 and 9
// are separate projects (none is #5729's or the concept lane's; key 1's project 429s on upload).
const KEY_NAMES = ['GEMINI_API_KEY_8', 'GEMINI_API_KEY_9'];
const keyOf = (name) => process.env[name];
const API = 'https://generativelanguage.googleapis.com/v1beta';
const ENDPOINT = 'eval/embed-prefix-100k';
const JOBS_FILE = path.join(DIR, 'jobs.json');
const readJobs = () => (fs.existsSync(JOBS_FILE) ? JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')) : []);
const writeJobs = (j) => fs.writeFileSync(JOBS_FILE, JSON.stringify(j, null, 1));
const docText = (format, r) => DOC_FORMS[format](r).slice(0, 8000); // production caps page text at 8,000 chars

async function* rows() {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DIR, 'pool.jsonl')), crlfDelay: Infinity });
  for await (const l of rl) if (l.trim()) yield JSON.parse(l);
}
const committed = () => readJobs().reduce((s, j) => s + (j.actual_usd ?? j.est_usd), 0);

async function submit(db) {
  const format = arg('--format');
  if (!DOC_FORMS[format]) { console.error('--format plain|prefix'); process.exit(1); }
  const jobRows = Number(arg('--job-rows', 10000));
  const maxUsd = Number(arg('--max-usd', 9.5));
  const maxRunning = Number(arg('--max-running', 3));
  // Rows already in a live job of this format, or collected with a vector.
  // Cancelled or failed requests ("The operation was cancelled", unbilled) go back in.
  const covered = new Set();
  for (const j of readJobs().filter((x) => x.format === format)) {
    const idx = j.idx || Array.from({ length: j.rows }, (_, k) => j.start + k);
    if (j.status === 'submitted') idx.forEach((i) => covered.add(i));
    else if (j.status === 'collected') { const bad = new Set(j.failed_rows || (j.vectors ? [] : idx)); idx.forEach((i) => { if (!bad.has(i)) covered.add(i); }); }
  }
  const isCovered = (i) => covered.has(i);
  let buf = []; let start = 0;
  const flush = async () => {
    if (!buf.length) return true;
    const chunk = buf; buf = [];
    const s0 = chunk[0].i;
    const busy = new Set(readJobs().filter((j) => j.status === 'submitted').map((j) => j.key));
    const keyName = KEY_NAMES.find((k) => !busy.has(k) && keyOf(k));
    if (!keyName || busy.size >= maxRunning) { console.log(`STOP: ${busy.size} jobs running (one per project, --max-running ${maxRunning}); collect, then submit again`); return false; }
    const KEY = keyOf(keyName);
    const perBook = new Map();
    const lines = chunk.map((r) => {
      const t = docText(format, r);
      const b = perBook.get(r.book_id) || { tokens: 0, pages: 0 }; b.tokens += estimateTextTokens(t); b.pages++; perBook.set(r.book_id, b);
      return JSON.stringify({ key: String(r.i), request: { content: { parts: [{ text: t }] }, outputDimensionality: DIMS } });
    });
    const est = [...perBook.values()].reduce((s, b) => s + usdForTokens(b.tokens, { batch: true }), 0);
    if (committed() + est > maxUsd) { console.log(`STOP: committed $${committed().toFixed(2)} + $${est.toFixed(2)} > $${maxUsd}`); return false; }
    const g = await budgetAllowsDispatchScoped(db, 'embed-prefix-test submit');
    if (!g.allowed) { console.log('STOP: spend gate closed'); return false; }
    if (g.envelopeIds) {
      const ok = new Set([...g.envelopeIds].map(String));
      const outside = [...perBook.keys()].filter((id) => !ok.has(id));
      if (outside.length) { console.log(`STOP: ${outside.length} books outside every open envelope`); return false; }
    }
    const jobId = `ep-${format}-${s0}-${Date.now().toString(36)}`;
    const fileName = await uploadBatchInputFile(lines.join('\n') + '\n', jobId, KEY);
    const created = await createThenDeleteInput({
      fileName, apiKey: KEY,
      create: async () => {
        for (let attempt = 0; ; attempt++) {
          const r = await fetch(`${API}/models/${MODEL}:asyncBatchEmbedContent?key=${KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch: { display_name: jobId, input_config: { file_name: fileName } } }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok) return j;
          if (r.status === 429 && attempt < 3) { await new Promise((res) => setTimeout(res, 60000 * (attempt + 1))); continue; }
          throw new Error(`batch create ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
        }
      },
    });
    for (const [bookId, b] of perBook) {
      await logUsage({ type: 'embedding', mode: 'batch', model: MODEL, book_id: bookId, page_count: b.pages, batch_job_id: `${jobId}:${bookId}`, input_tokens: 0, output_tokens: 0, status: 'submitted', endpoint: ENDPOINT, cost_usd: +usdForTokens(b.tokens, { batch: true }).toFixed(6) }, db);
    }
    const jobs = readJobs();
    jobs.push({ id: jobId, name: created.name, key: keyName, format, start: s0, rows: chunk.length, idx: chunk.map((r) => r.i), books: [...perBook.keys()], est_usd: +est.toFixed(4), status: 'submitted', at: new Date() });
    writeJobs(jobs);
    console.log(`submitted ${jobId} → ${created.name}: ${chunk.length} rows, ${perBook.size} books, est $${est.toFixed(3)}`);
    return true;
  };
  for await (const r of rows()) {
    if (isCovered(r.i)) continue;
    buf.push(r);
    if (buf.length >= jobRows && !(await flush())) return;
  }
  await flush();
}

async function collect(db) {
  const jobs = readJobs();
  for (const job of jobs.filter((j) => j.status === 'submitted')) {
    const KEY = keyOf(job.key || 'GEMINI_API_KEY_8');
    const r = await (await fetch(`${API}/${job.name}?key=${KEY}`)).json();
    const state = r.metadata?.state || r.state || 'UNKNOWN';
    if (/FAILED|CANCELLED|EXPIRED/.test(state)) {
      job.status = 'failed'; job.state = state;
      for (const id of job.books) await completeBatchUsage({ batch_job_id: `${job.id}:${id}`, model: MODEL, input_tokens: 0, output_tokens: 0, status: 'failed', error_message: state, insertIfMissing: false }, db);
      console.log(`${job.id}: ${state}`); continue;
    }
    const file = r.response?.responsesFile || r.metadata?.output?.responsesFile;
    if (!/SUCCEEDED/.test(state) || !file) { console.log(`${job.id}: ${state} ${JSON.stringify(r.metadata?.batchStats || {})}`); continue; }
    const vdir = path.join(DIR, `vec-${job.format}`); fs.mkdirSync(vdir, { recursive: true });
    const idx = []; const parts = []; let failed = 0;
    const bookOf = new Map();
    const want = new Set(job.idx || Array.from({ length: job.rows }, (_, k) => job.start + k));
    for await (const row of rows()) if (want.has(row.i)) bookOf.set(row.i, row.book_id);
    const failedRows = [];
    const perBook = new Map(job.books.map((id) => [id, { tokens: 0, pages: 0 }]));
    for await (const line of streamBatchResponses(file, KEY)) {
      const i = Number(line.key ?? line.metadata?.key);
      const b = perBook.get(bookOf.get(i));
      if (b) b.tokens += line.response?.usageMetadata?.promptTokenCount || 0;
      const v = line.response?.embedding?.values;
      if (line.error || !v || v.length !== DIMS) { failed++; failedRows.push(i); continue; }
      const nrm = Math.hypot(...v) || 1;
      idx.push(i); parts.push(Float32Array.from(v, (x) => x / nrm));
      if (b) b.pages++;
    }
    const buf = Buffer.alloc(parts.length * DIMS * 4);
    parts.forEach((v, k) => Buffer.from(v.buffer).copy(buf, k * DIMS * 4));
    fs.writeFileSync(path.join(vdir, `${job.id}.f32`), buf);
    fs.writeFileSync(path.join(vdir, `${job.id}.rows.json`), JSON.stringify(idx));
    let actual = 0; let tokens = 0;
    for (const [id, b] of perBook) {
      actual += usdForTokens(b.tokens, { batch: true }); tokens += b.tokens;
      await completeBatchUsage({ batch_job_id: `${job.id}:${id}`, model: MODEL, input_tokens: b.tokens, output_tokens: 0, cost_usd: +usdForTokens(b.tokens, { batch: true }).toFixed(6), status: b.tokens ? 'success' : 'failed', type: 'embedding', mode: 'batch', book_id: id, page_count: b.pages, endpoint: ENDPOINT }, db);
    }
    Object.assign(job, { status: 'collected', state, vectors: idx.length, failed, failed_rows: failedRows, tokens, actual_usd: +actual.toFixed(4) });
    writeJobs(jobs);
    console.log(`${job.id}: ${idx.length} vectors, ${failed} failed, ${tokens} billed tokens, $${actual.toFixed(4)}`);
  }
  writeJobs(jobs);
}

await withMongo(async (db) => {
  if (CMD === 'submit') return submit(db);
  if (CMD === 'collect') return collect(db);
  if (CMD === 'status') { for (const j of readJobs()) console.log(j.id, j.format, j.status, j.rows, j.vectors ?? '', j.failed ?? '', j.est_usd, j.actual_usd ?? ''); console.log(`committed $${committed().toFixed(2)}`); return; }
  console.error('usage: submit | collect | status --dir D'); process.exit(1);
}, { timeoutMs: 7_200_000 });
