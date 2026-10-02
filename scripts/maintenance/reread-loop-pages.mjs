#!/usr/bin/env node
/**
 * PRIOR ART: scripts/batch/bulk-reocr-local.mjs — the Batch-API OCR path, but its results are
 * written by batch-collector.mjs with no second pass and no verdict beyond the write gate, and
 * the #3878 pilot measured that production settings (lite, temp 0.1) re-loop on 11/30 of these
 * pages. scripts/maintenance/apply-reocr-verdicts.mjs — the SERVE / MARK_UNRELIABLE write
 * shape copied here (revisions first, human-edit guard in the filter, unreadable flag keeps the
 * old text), but it applies an external engine's judged reads, not a Gemini re-read.
 * scripts/audit/ocr-loop-corpus.mjs — finds the loops; never writes.
 *
 * Re-read pages whose stored OCR is a degeneration loop (#3878).
 *
 * WHO RUNS IT: an operator on the Hetzner box, against named books, dry-run first.
 *   node --env-file=.env.production.local scripts/maintenance/reread-loop-pages.mjs plan    --run=R --book-ids-file=ids.txt
 *   node --env-file=.env.production.local scripts/maintenance/reread-loop-pages.mjs submit  --run=R --pass=1 --approved-usd=10
 *   node --env-file=.env.production.local scripts/maintenance/reread-loop-pages.mjs collect --run=R          (exit 3 = still running)
 *   node --env-file=.env.production.local scripts/maintenance/reread-loop-pages.mjs submit  --run=R --pass=2 --approved-usd=10
 *   node --env-file=.env.production.local scripts/maintenance/reread-loop-pages.mjs collect --run=R
 *   node --env-file=.env.production.local scripts/maintenance/reread-loop-pages.mjs apply   --run=R [--apply]
 *
 * THE LANE (measured on 30 looping pages, scripts/eval/experiments/2026-10-01-…-3878.md):
 *   pass 1  gemini-3.1-flash-lite, temperature 0.7 — loops least and costs least (it stops early)
 *   pass 2  gemini-3-flash-preview, temperature 0.1 — only for pages pass 1 did not get
 *   verdict scripts/lib/reread-verdict.mjs — loop, near-loop, declined, max-tokens, runaway,
 *           script-mismatch. Cascade accepted 20/30 in the pilot; by eye ≈ 19–20 were readings.
 *
 * WHAT apply WRITES (dry-run unless --apply):
 *   SERVE    a re-read that passed: old ocr snapshotted to page_revisions (reason below), new
 *            text with model, prompt, content_hash and an `ocr.reread` provenance block.
 *   MARK     both passes failed for a reason that means "not readable by Gemini" (loop,
 *            near-loop, declined, max-tokens, runaway): `ocr.unreadable` + reason. The old text is
 *            retained for provenance and is no longer served or counted.
 *   REVIEW   a pass failed ONLY on script-mismatch, or the page was selected only as a
 *            near-loop (a formulaic enumeration can be genuine): nothing written. The catalogue language may
 *            be the wrong one (a Hebrew-catalogued page read as Arabic twice in the pilot), and
 *            withholding on a guess would hide real text. Listed in the report.
 *   Human edits win (`ocr.edited_by`, `ocr.source: 'manual'`) — in the update filter.
 *
 * NEVER changes `pipeline_auto.status`. Never touches a page not named in the run's plan.
 * A SERVE write stamps `ocr.updated_at`, so any existing translation reads as stale
 * (scripts/lib/stale-translation.mjs: OCR newer than translation) and is flagged for
 * re-translation — paid work, inside the caller's envelope. This lane is NOT in
 * WITHHOLD_LANES, so the old translation stays visible until re-translated; on these pages it
 * was built on a loop and is usually already withheld by the loop arm (#4899). Usage is metered per book through logUsage, so getScopeSpendUsd sees it.
 *
 * Kill switch: touch scripts/output/reread-loop/STOP — submit and apply refuse to start.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { rereadVerdict, storedLoops, decide } from '../lib/reread-verdict.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { contentHash } from '../lib/translate-core.mjs';
import { batchJobProvenance, engineFromBatchJob, imageInput, ocrProvenance, codeVersion } from '../lib/write-provenance.mjs';
import { liftOcrTags } from '../lib/ocr-result-parse.mjs';
import { STALE_OCR_FIELDS } from '../lib/syriac-kraken-lane.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';
import { isTruncatedCandidate } from '../lib/truncated-response.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { logUsage, calculateUsageCost } from '../workers/lib/supabase-usage-logger.mjs';
import { createThenDeleteInput } from '../lib/gemini-batch-input-file.mjs';

const ISSUE = 3878;
const REASON = 'reread-loop-3878';
const SWEEP = 'reread-loop-3878';
const CALL_SITE = 'scripts/maintenance/reread-loop-pages.mjs';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const PASSES = {
  1: { model: 'gemini-3.1-flash-lite', temperature: 0.7 },
  2: { model: 'gemini-3-flash-preview', temperature: 0.1 },
};
// 8,192 tokens is ~25K+ characters of Latin — at or past HALLUCINATION_LIMIT, which the verdict
// refuses anyway. A higher cap only bills a runaway: on the mini test two lite-0.7 pages ran to
// 43K and 59K characters (#5194 proposes the same cap for production OCR).
const MAX_OUTPUT_TOKENS = 8192;
// File-based jobs, bounded by bytes first and pages second (bulk-reocr-local.mjs defaults, #3974).
// An inline request carries only ~15 MB, and these pages' images are large enough that it held
// ONE page per job — the first production run submitted 138 single-page jobs before it was stopped.
const FILE_MAX_BYTES = 40 * 1024 * 1024;
const FILE_MAX_PAGES = 500;
// Long-edge cap for the page image sent. Some of these books' scans run to ~8 MB a page, which
// held 4–14 pages per 40 MB job and would have put ~16 GB on the shared 20 GB File API quota.
// The pilot's images averaged ~2 MB at their native size, so 3,000 px keeps the measured
// condition for ordinary pages (they are sent untouched) and shrinks only the giants. The
// pipeline itself sends 1,500 px (pipeline-orchestrator.mjs OCR_IMAGE_MAX_PX); this lane was
// measured larger, so it stays larger. Recorded on every page as engine.image_resized_to_px.
const IMAGE_MAX_PX = 3000;
/** Batch-rate cost per page measured on the pilot (#3878), × 1.5 headroom for the estimate. */
const EST_USD_PER_PAGE = { 1: 0.0046 * 1.5, 2: 0.0049 * 1.5 }; // pass 1 re-measured on the file-based mini test (runaways included)
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY'].map(category => ({ category, threshold: 'BLOCK_NONE' }));
const HUMAN_GUARD = { 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' } };
const literal = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { $literal: v }]));
const ENSURE_OCR = { $set: { ocr: { $cond: { if: { $eq: [{ $type: '$ocr' }, 'object'] }, then: '$ocr', else: {} } } } };

const args = process.argv.slice(2);
const cmd = args[0];
const arg = (n, d = null) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const flag = (n) => args.includes(`--${n}`);
const RUN = arg('run');
if (!['plan', 'submit', 'collect', 'apply'].includes(cmd) || !RUN || !/^[a-z0-9-]+$/.test(RUN)) {
  console.error('usage: reread-loop-pages.mjs plan|submit|collect|apply --run=<kebab-name> [...] (see header)');
  process.exit(2);
}
const ROOT = path.resolve('scripts/output/reread-loop');
const DIR = path.join(ROOT, RUN);
const STATE = path.join(DIR, 'state.json');
fs.mkdirSync(DIR, { recursive: true });
const load = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const save = (s) => { fs.writeFileSync(STATE + '.tmp', JSON.stringify(s, null, 1)); fs.renameSync(STATE + '.tmp', STATE); };
const stopped = () => fs.existsSync(path.join(ROOT, 'STOP'));
const apiKey = () => process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
try {
  if (cmd === 'plan') await plan();
  else if (cmd === 'submit') await submit();
  else if (cmd === 'collect') process.exitCode = await collect();
  else await apply();
} finally {
  await client.close();
}

async function plan() {
  const file = arg('book-ids-file');
  if (!file) throw new Error('plan needs --book-ids-file');
  if (fs.existsSync(STATE)) throw new Error(`${STATE} exists — a run's plan is fixed once made; use a new --run`);
  const ids = fs.readFileSync(file, 'utf8').split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean);
  const books = await db.collection('books').find({ id: { $in: ids } },
    { projection: { id: 1, title: 1, language: 1, hidden_reason: 1, 'pipeline_auto.hold': 1 } }).toArray();
  const pages = [];
  const skipped = { notFound: ids.length - books.length, humanEdited: 0, alreadyUnreadable: 0, noImage: 0 };
  for (const b of books) {
    const cur = db.collection('pages').find({ book_id: b.id },
      { projection: { id: 1, page_number: 1, photo: 1, display_photo: 1, archived_photo: 1, photo_original: 1, cropped_photo: 1, crop: 1, 'ocr.data': 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.unreadable': 1 } });
    for await (const p of cur) {
      const why = storedLoops(p.ocr?.data);
      if (!why) continue;
      if (p.ocr?.edited_by || p.ocr?.source === 'manual') { skipped.humanEdited++; continue; }
      if (p.ocr?.unreadable === true) { skipped.alreadyUnreadable++; continue; }
      const url = getPageSource(p);
      if (!url) { skipped.noImage++; continue; }
      pages.push({ page_id: p.id, book_id: b.id, page_number: p.page_number, language: b.language || null, stored: why, url });
    }
  }
  const est = +(pages.length * EST_USD_PER_PAGE[1] + pages.length * 0.4 * EST_USD_PER_PAGE[2]).toFixed(2);
  save({ run: RUN, issue: ISSUE, created_at: new Date().toISOString(), books: books.map(b => ({ id: b.id, title: b.title, language: b.language, hidden_reason: b.hidden_reason ?? null, held: Boolean(b.pipeline_auto?.hold) })), pages, skipped, jobs: [], results: {} });
  console.log(`plan ${RUN}: ${books.length} books, ${pages.length} looping pages; skipped ${JSON.stringify(skipped)}`);
  console.log(`estimate: pass 1 $${(pages.length * EST_USD_PER_PAGE[1]).toFixed(2)}, pass 2 (≈40%) $${(pages.length * 0.4 * EST_USD_PER_PAGE[2]).toFixed(2)}, total ≈ $${est}`);
}

async function submit() {
  if (stopped()) throw new Error('STOP file present');
  const pass = Number(arg('pass'));
  const approved = Number(arg('approved-usd'));
  if (!PASSES[pass]) throw new Error('--pass=1|2');
  if (!(approved > 0)) throw new Error('submit needs --approved-usd (the ceiling this run may spend)');
  const s = load();
  // Resumable: a page already in one of this pass's jobs is not sent again.
  const sent = new Set(s.jobs.filter(j => j.pass === pass).flatMap(j => j.page_ids));
  let todo = s.pages.filter(p => !sent.has(p.page_id));
  if (pass === 2) {
    if (s.jobs.some(j => j.pass === 1 && !j.collected)) throw new Error('pass 1 not fully collected');
    todo = todo.filter(p => !s.results[p.page_id]?.[1]?.accept);
  }
  if (!todo.length) { console.log(`pass ${pass}: nothing left to submit`); return; }
  const est = todo.length * EST_USD_PER_PAGE[pass];
  const spent = s.jobs.reduce((t, j) => t + (j.cost_usd || 0), 0);
  if (spent + est > approved) throw new Error(`refusing: spent $${spent.toFixed(2)} + estimate $${est.toFixed(2)} > approved $${approved}`);
  const prompt = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  if (!prompt?.content) throw new Error('no default OCR prompt');
  const promptText = prompt.content
    .replace('{language_instruction}', '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).')
    .replace('{language}', '');
  s.prompt = { id: prompt._id?.toString(), name: prompt.name, version: prompt.version, hash: contentHash(promptText) };
  const { model, temperature } = PASSES[pass];
  const generationConfig = { temperature, maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingBudget: 0 } };
  // The #4613 engine block, recorded at submit and completed per page at apply (as the collector does).
  const provenance = batchJobProvenance({
    call_site: CALL_SITE, model,
    prompt: { id: s.prompt.id, name: s.prompt.name, version: s.prompt.version, hash: s.prompt.hash, text: promptText },
    generationConfig, run: { code_version: await codeVersion(), host: os.hostname() }, image_resized_to_px: IMAGE_MAX_PX,
  });
  let chunk = [], bytes = 0, failed = 0;
  const flush = async () => {
    if (!chunk.length) return;
    const displayName = `${REASON}-${RUN}-p${pass}-${s.jobs.length}`;
    const fileName = await uploadJsonl(chunk.map(c => JSON.stringify(c.req)).join('\n'), displayName);
    // The input is deleted once create returns (#5544) — it no longer holds File API quota.
    const j = await createThenDeleteInput({ fileName, apiKey: apiKey(), create: async () => {
      const r = await fetch(`${API}/models/${model}:batchGenerateContent?key=${apiKey()}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: { display_name: displayName, input_config: { file_name: fileName } } }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(`batch create ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
      return body;
    } });
    s.jobs.push({ pass, model, temperature, provenance, job: j.name, page_ids: chunk.map(c => c.page_id), submitted_at: new Date().toISOString(), collected: false });
    save(s);
    console.log(`pass ${pass}: ${j.name} (${chunk.length} pages)`);
    chunk = []; bytes = 0;
  };
  for (const p of todo) {
    const r = await fetch(p.url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Mozilla/5.0 (SourceLibrary reread-loop)' } }).catch(() => null);
    if (!r?.ok) { failed++; s.results[p.page_id] = { ...(s.results[p.page_id] || {}), [pass]: { accept: false, reasons: ['image-fetch-failed'] } }; continue; }
    const img = await capImage(Buffer.from(await r.arrayBuffer()), (r.headers.get('content-type') || 'image/jpeg').split(';')[0]);
    const data = img.buf.toString('base64');
    if (chunk.length && (chunk.length >= FILE_MAX_PAGES || bytes + data.length > FILE_MAX_BYTES)) await flush();
    chunk.push({ page_id: p.page_id, req: {
      request: {
        contents: [{ parts: [{ text: promptText }, { inlineData: { mimeType: img.mimeType, data } }] }],
        safetySettings: SAFETY,
        generationConfig,
      },
      // The JSONL shape bulk-reocr-local.mjs submits and batch-collector.mjs reads back.
      metadata: { key: p.page_id },
    } });
    bytes += data.length;
  }
  await flush();
  save(s);
  console.log(`pass ${pass}: submitted ${todo.length - failed} pages; ${failed} image fetches failed (recorded)`);
}

/** Shrink an image whose long edge exceeds IMAGE_MAX_PX; anything smaller is sent byte-for-byte. */
async function capImage(buf, mimeType) {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buf).metadata();
    if (Math.max(meta.width || 0, meta.height || 0) <= IMAGE_MAX_PX) return { buf, mimeType };
    const out = await sharp(buf).resize({ width: IMAGE_MAX_PX, height: IMAGE_MAX_PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return { buf: out, mimeType: 'image/jpeg' };
  } catch {
    return { buf, mimeType }; // unreadable by sharp: send as fetched, as the pipeline does
  }
}

/** Upload a JSONL body to the File API (resumable protocol); returns the file name. */
async function uploadJsonl(body, displayName) {
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(Buffer.byteLength(body)), 'X-Goog-Upload-Header-Content-Type': 'text/plain',
    },
    body: JSON.stringify({ file: { displayName } }),
  });
  if (!start.ok) throw new Error(`upload start ${start.status}: ${await start.text()}`);
  const url = start.headers.get('X-Goog-Upload-URL');
  if (!url) throw new Error('no upload URL returned');
  for (let attempt = 1; ; attempt++) {
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body }).catch(e => ({ ok: false, status: e.message }));
    if (put.ok) { const info = await put.json(); if (!info.file?.name) throw new Error('upload returned no file name'); return info.file.name; }
    if (attempt >= 3) throw new Error(`upload PUT failed: ${put.status}`);
    await new Promise(r => setTimeout(r, 30000));
  }
}

/** @returns {Promise<number>} 0 when every job is collected, 3 while any is still running */
async function collect() {
  const s = load();
  const byId = new Map(s.pages.map(p => [p.page_id, p]));
  let pending = 0;
  for (const j of s.jobs) {
    if (j.collected) continue;
    const r = await (await fetch(`${API}/${j.job}?key=${apiKey()}`)).json();
    const state = r.metadata?.state || r.state || 'UNKNOWN';
    if (/FAILED|CANCELLED|EXPIRED/.test(state)) {
      for (const id of j.page_ids) s.results[id] = { ...(s.results[id] || {}), [j.pass]: { accept: false, reasons: [`job-${state}`] } };
      j.collected = true; j.state = state; save(s); continue;
    }
    if (!/SUCCEEDED/.test(state)) { pending++; continue; }
    let resp = r.response?.inlinedResponses?.inlinedResponses || r.response?.inlinedResponses || [];
    const outFile = r.response?.responsesFile || r.dest?.fileName;
    if (outFile) {
      const f = await fetch(`${API}/${outFile}:download?alt=media&key=${apiKey()}`);
      if (!f.ok) { console.log(`${j.job}: results file not downloadable yet (${f.status})`); pending++; continue; }
      resp = (await f.text()).trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    }
    const usageByBook = new Map();
    const textDir = path.join(DIR, `pass${j.pass}`);
    fs.mkdirSync(textDir, { recursive: true });
    for (const x of resp) {
      const id = x.key ?? x.metadata?.key; const p = byId.get(id);
      if (!p) continue;
      const c = x.response?.candidates?.[0];
      const text = c?.content?.parts?.map(q => q.text || '').join('') || '';
      fs.writeFileSync(path.join(textDir, `${id}.txt`), text);
      const v = rereadVerdict(text, { language: p.language, truncated: isTruncatedCandidate(c) });
      s.results[id] = { ...(s.results[id] || {}), [j.pass]: { ...v, finish: c?.finishReason ?? null, model: j.model, temperature: j.temperature, job: j.job } };
      const u = x.response?.usageMetadata || {};
      const b = usageByBook.get(p.book_id) || { in: 0, out: 0, pages: 0 };
      b.in += u.promptTokenCount || 0; b.out += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0); b.pages++;
      usageByBook.set(p.book_id, b);
    }
    let cost = 0;
    for (const [book_id, b] of usageByBook) {
      const usd = calculateUsageCost(j.model, b.in, b.out, true);
      await logUsage({ type: 'ocr', mode: 'batch', model: j.model, book_id, page_count: b.pages, input_tokens: b.in, output_tokens: b.out,
        cost_usd: usd, batch_job_id: j.job, endpoint: CALL_SITE, triggered_by: 'manual', prompt_version: s.prompt?.version ?? null }, db);
      cost += usd;
    }
    j.collected = true; j.state = state; j.cost_usd = +cost.toFixed(4); save(s);
    const acc = j.page_ids.filter(id => s.results[id]?.[j.pass]?.accept).length;
    console.log(`collected ${j.job}: ${acc}/${j.page_ids.length} accepted, $${cost.toFixed(4)}`);
  }
  if (pending) console.log(`${pending} job(s) still running`);
  return pending ? 3 : 0;
}

async function apply() {
  const write = flag('apply');
  if (write && stopped()) throw new Error('STOP file present');
  const s = load();
  const byBook = new Map();
  for (const p of s.pages) { if (!byBook.has(p.book_id)) byBook.set(p.book_id, []); byBook.get(p.book_id).push(p); }
  const totals = { SERVE: 0, MARK: 0, REVIEW: 0, PENDING: 0, raced: 0 };
  const report = [];
  for (const [bookId, pages] of byBook) {
    const plan = pages.map(p => ({ p, d: decide(s.results[p.page_id], p.stored) }));
    for (const { p, d } of plan) report.push({ book: bookId, page: p.page_number, page_id: p.page_id, ...d });
    const serve = plan.filter(x => x.d.action === 'SERVE');
    const mark = plan.filter(x => x.d.action === 'MARK');
    for (const x of plan) if (x.d.action === 'REVIEW' || x.d.action === 'PENDING') totals[x.d.action]++;
    if (!write) { totals.SERVE += serve.length; totals.MARK += mark.length; continue; }
    if (!serve.length && !mark.length) continue;
    const now = new Date();
    if (serve.length) {
      const ids = serve.map(x => x.p.page_id);
      const n = await saveRevisionsBeforeOverwrite(db, ids, 'ocr', { reason: REASON, keepMeta: true });
      if (n !== ids.length) { console.error(`ABORT ${bookId}: revisions ${n} != ${ids.length}`); continue; }
    }
    let served = 0, marked = 0;
    for (const { p, d } of serve) {
      const r = s.results[p.page_id][d.pass];
      const text = fs.readFileSync(path.join(DIR, `pass${d.pass}`, `${p.page_id}.txt`), 'utf8');
      // The write boundary's own screen (#4850), re-run on the exact bytes about to be stored.
      if (loopVerdict(text).refuse) { totals.raced++; continue; }
      const job = s.jobs.find(j => j.job === r.job);
      const prov = ocrProvenance(text, engineFromBatchJob(job, { batch_job_id: r.job, input: imageInput({ url: p.url }), collected_by: CALL_SITE, now }));
      const set = {
        'ocr.data': text, 'ocr.model': r.model, 'ocr.updated_at': now, 'ocr.language': p.language,
        'ocr.has_warning': /<warning[\s>]/i.test(text),
        // A narrower provenance label than 'batch_api', as the collector allows, so the
        // measurement stack can segment this lane's pages (.claude/docs/data-provenance.md).
        'ocr.source': REASON, 'ocr.source_url': p.url,
        'ocr.prompt_id': s.prompt?.id ?? null, 'ocr.prompt_version': s.prompt?.version ?? null, 'ocr.prompt_hash': s.prompt?.hash ?? null,
        'ocr.prompt_name': s.prompt?.name ?? null, 'ocr.batch_job_id': r.job, 'ocr.pipeline': REASON,
        'ocr.content_hash': prov.content_hash, 'ocr.engine': prov.engine,
        ...liftOcrTags(text), // page_type, columns, script_type — whichever parsed
        'ocr.reread': { issue: ISSUE, run: RUN, pass: d.pass, temperature: r.temperature, replaced: p.stored, verdict: { reasons: r.reasons, script: r.script }, at: now, by: CALL_SITE },
        updated_at: now,
      };
      const unset = STALE_OCR_FIELDS.filter(f => !(f in set));
      const res = await db.collection('pages').updateOne({ id: p.page_id, ...HUMAN_GUARD }, [ENSURE_OCR, { $set: literal(set) }, { $unset: unset }]);
      if (res.modifiedCount === 1) served++; else totals.raced++;
    }
    for (const { p, d } of mark) {
      const set = { 'ocr.unreadable': true, 'ocr.unreadable_reason': REASON,
        'ocr.reread': { issue: ISSUE, run: RUN, outcome: 'unreadable', reasons: d.reasons, at: now, by: CALL_SITE }, updated_at: now };
      const res = await db.collection('pages').updateOne({ id: p.page_id, ...HUMAN_GUARD }, [ENSURE_OCR, { $set: literal(set) }]);
      if (res.modifiedCount === 1) marked++; else totals.raced++;
    }
    totals.SERVE += served; totals.MARK += marked;
    const recount = await recountBook(db, bookId, { reason: CALL_SITE, now });
    await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'reread-loop-pages',
      detail: { issue: ISSUE, run: RUN, served, marked, pages_ocr_after: recount.after?.pages_ocr ?? null } });
  }
  fs.writeFileSync(path.join(DIR, write ? 'apply-report.json' : 'dry-run-report.json'), JSON.stringify({ totals, report }, null, 1));
  console.log(`${write ? 'APPLIED' : 'dry-run'} ${RUN}: ${JSON.stringify(totals)} → ${path.join(DIR, write ? 'apply-report.json' : 'dry-run-report.json')}`);
}
