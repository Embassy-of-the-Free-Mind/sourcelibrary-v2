#!/usr/bin/env node
// PRIOR ART: scripts/eval/judge-cal-7866bar-7263/three-way.mjs (#7941: the one normaliser `normalise('ours')`, the
// blind Opus judge `judgeAbsolute` against the page image, imported); judge-cal-7866bar-7263/lib.mjs (#7263: the
// typed-reference truth rule `truthLatin` / `truthHan`, imported) and its 60 print + 40 Chinese manuscript pages with
// same-edition typed references; results/en-ocr-ref-5124 (#5124: Wikisource / Gutenberg references, set B as #7941
// drew it, three-way-added.json). scripts/eval/ocr-v18-ab.mjs (#4195: the production lite request shape and the REST
// Batch submit / poll, imported). scripts/batch/cli-ocr.mjs (the agy read: live prompt + its sentinel image
// instruction, the tool gate, agyCall; restated in `agyRead` because cli-ocr reads the live prompt itself and cannot
// take an edited one). plain-6728 / translation-notes-free (anchored prompt edits; prompts.mjs here). #5939 compared
// OCR prompt versions on CER only; none of these removes the OCR prompt's notes / vocab / term / image-desc load.
/**
 * Does the OCR prompt's notes / vocab / term / image-description load cost transcription accuracy? (#7966)
 * Pre-registered in scripts/eval/ocr-plain-7966/PREREGISTRATION.md (committed before any model call).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ocr-plain-7966/run.mjs <stage>
 *     pages        the page set (A: #7263 print 60; B: #5124 35; Z: #7263 Chinese manuscript, seeded 20) + images
 *     prompts      the live prompt, the four arms (anchored edits) → results/prompts.json
 *     lite-build   requests-<arm>.jsonl (the orchestrator's request: prompt + Document context, image ≤1500 px)
 *     lite-submit --approved-usd=N   one Batch job per arm (registered as external_eval)
 *     lite-poll    collect; lite-retry resubmits unanswered requests once
 *     agy [--arm=X] [--conc=3]       agy -p gemini-3.8-flash-low, cli-ocr's one-page call, fresh
 *     judge        blind Opus judge on every (engine, arm, page) normalised text; identical texts judged once
 *     score        → results/score.json, results/pages.jsonl (numbers only, no page text)
 *     show <uid> <engine> <arm>      print one normalised read (eye check)
 * Nothing here writes to pages, books, prompts or routing. batch_jobs gets the eval registration rows only.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { ARMS, armPrompt, assertArm, LIVE_HASH, md5 } from './prompts.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { normalizeForScript, windowedErrorRate } from '../lib/metrics.mjs';
import { bodyText } from '../ground-truth-5935/lib.mjs';
import { truthLatin, truthHan } from '../judge-cal-7866bar-7263/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const RESULTS = path.join(HERE, 'results');
const OUT = path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'ocr-plain-7966');
const SRC7263 = process.env.SRC7263 || '/data/scratch/sl/jobs/router-defaults-calib-7263/judge-cal-7866bar';
const R5124 = path.join(ROOT, 'scripts/eval/results/en-ocr-ref-5124');
for (const d of [RESULTS, OUT, path.join(OUT, 'items'), path.join(OUT, 'img'), path.join(OUT, 'lite'), path.join(OUT, 'agy')]) fs.mkdirSync(d, { recursive: true });
export const SEED = Object.freeze({ zh: 79661, queue: 79662, boot: 79663 });
export const N_ZH = 20, OPUS_CAP = 1000, LITE_CAP_USD = 3, AGY_MODEL = 'gemini-3.8-flash-low';
export const ENGINES = ['lite', 'agy'];
const arg = (n, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const sha = (s) => createHash('sha256').update(typeof s === 'string' ? s : s).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const append = (f, r) => fs.appendFileSync(f, JSON.stringify({ ...r, at: new Date().toISOString() }) + '\n');
const shuffle = (xs, rng) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
async function mongo() { const c = await MongoClient.connect(process.env.MONGODB_URI); return { c, db: c.db(process.env.MONGODB_DB || 'bookstore') }; }
const F = { pages: path.join(OUT, 'pages.json'), prompts: path.join(OUT, 'prompts.json'), agy: path.join(OUT, 'agy-reads.jsonl'), verdicts: path.join(OUT, 'verdicts.jsonl') };
const UA = 'SourceLibrary-eval/7966 (https://sourcelibrary.org; internal quality measurement)';

// ── stage pages ──
async function pages() {
  const draw = J(path.join(ROOT, 'scripts/eval/judge-cal-7866bar-7263/results/draw.json')).drawn;
  const zhAll = draw.filter((d) => d.stratum === 'manuscript').sort((a, b) => a.uid.localeCompare(b.uid));
  const zh = shuffle(zhAll, makeRng(SEED.zh)).slice(0, N_ZH);
  const rows = [];
  for (const d of [...draw.filter((x) => x.stratum === 'print'), ...zh]) {
    const it = J(path.join(SRC7263, 'items', `${d.uid}.json`));
    const item = d.stratum === 'print' ? { ref: { text: it.ref.text, notes: it.ref.notes || [] }, win: it.win.map((w) => (typeof w === 'string' ? w : w?.text ?? '')) } : { pbs: it.pbs, k: it.k };
    fs.writeFileSync(path.join(OUT, 'items', `${d.uid}.json`), JSON.stringify(item));
    rows.push({ uid: d.uid, set: d.stratum === 'print' ? 'A' : 'Z', lang: d.lang, book_id: d.book_id, page_id: d.page_id, page_number: d.page_number, image: d.image, ref_source: d.ref?.source ?? 'kanripo', ref_sha: sha(JSON.stringify(item)).slice(0, 16) });
  }
  for (const r of J(path.join(ROOT, 'scripts/eval/judge-cal-7866bar-7263/results/three-way-added.json')).added) {
    const ref = fs.readFileSync(path.join(R5124, 'refs', `${r.slug}.txt`), 'utf8');
    const item = { ref: { text: ref, notes: [] }, win: [ref] };
    fs.writeFileSync(path.join(OUT, 'items', `${r.uid}.json`), JSON.stringify(item));
    rows.push({ uid: r.uid, set: 'B', lang: 'English', book_id: r.book_id, page_id: r.page_id, page_number: r.page_number, image: r.image, ref_source: r.ref_source, ref_sha: sha(JSON.stringify(item)).slice(0, 16) });
  }
  const { c, db } = await mongo();
  const books = new Map((await db.collection('books').find({ id: { $in: rows.map((r) => r.book_id) } }, { projection: { _id: 0, id: 1, title: 1, author: 1, year: 1, needs_splitting: 1, visible: 1 } }).toArray()).map((b) => [b.id, b]));
  await c.close();
  for (const r of rows) {
    const b = books.get(r.book_id) || {};
    Object.assign(r, { title: b.title ?? null, author: b.author ?? null, year: b.year ?? null, needs_splitting: !!b.needs_splitting });
    const f = path.join(OUT, 'img', `${r.uid}.jpg`);
    if (!fs.existsSync(f)) {
      const res = await fetch(r.image, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60e3) });
      if (!res.ok) { r.excluded = `image HTTP ${res.status}`; console.log(r.uid, r.excluded); continue; }
      fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    }
    r.image_sha256 = sha(fs.readFileSync(f));
  }
  fs.writeFileSync(F.pages, JSON.stringify(rows, null, 1));
  const by = rows.reduce((m, r) => ((m[`${r.set} ${r.lang}`] = (m[`${r.set} ${r.lang}`] || 0) + 1), m), {});
  console.log(rows.length, 'pages', JSON.stringify(by), 'needs_splitting', rows.filter((r) => r.needs_splitting).length, 'excluded', rows.filter((r) => r.excluded).length);
}
const pageList = () => J(F.pages).filter((r) => !r.excluded && !r.needs_splitting);
const itemOf = (uid) => J(path.join(OUT, 'items', `${uid}.json`));

// ── stage prompts ──
async function prompts() {
  const { liveOcrPrompt } = await import('../../lib/live-ocr-prompt.mjs');
  const { c, db } = await mongo();
  const row = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  const { base, ref } = await liveOcrPrompt(db);
  await c.close();
  if (md5(row.content) !== LIVE_HASH || ref.hash !== LIVE_HASH) throw new Error(`live prompt moved: md5 ${md5(row.content)} / row ${ref.hash}, pre-registered ${LIVE_HASH}`);
  const arms = {};
  for (const a of ARMS) { const t = armPrompt(base, a); assertArm(t, a); arms[a] = { md5: md5(t), chars: t.length, text: t }; }
  fs.writeFileSync(F.prompts, JSON.stringify({ ref, base_md5: md5(base), arms }, null, 1));
  fs.writeFileSync(path.join(RESULTS, 'prompts.json'), JSON.stringify({ ref, base_md5: md5(base), arms: Object.fromEntries(Object.entries(arms).map(([a, x]) => [a, { md5: x.md5, chars: x.chars }])) }, null, 1) + '\n');
  for (const a of ARMS) console.log(a, arms[a].md5, arms[a].chars);
}
const armText = (a) => J(F.prompts).arms[a].text;

// ── lite: the orchestrator's request ──
async function liteImage(uid) {   // pipeline-orchestrator fetchImageBase64 with maxDim 1500, on the cached bytes
  const buf = fs.readFileSync(path.join(OUT, 'img', `${uid}.jpg`));
  if (buf.length <= 100_000) return { data: buf.toString('base64'), mimeType: 'image/jpeg' };
  const sharp = (await import('sharp')).default;
  return { data: (await sharp(buf).resize({ width: 1500, height: 1500, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()).toString('base64'), mimeType: 'image/jpeg' };
}
const LITE_CFG = { work: path.join(OUT, 'lite'), arms: ARMS, jobName: 'ocr-plain-7966', endpoint: 'eval/ocr-plain-7966', capUsd: LITE_CAP_USD };
async function liteBuild() {
  const { SAFETY, OCR_GENERATION_CONFIG, docContext, MODEL } = await import('../ocr-v18-ab.mjs');
  const ps = pageList(); let inTok = 0;
  for (const a of ARMS) {
    const s = fs.createWriteStream(path.join(LITE_CFG.work, `requests-${a}.jsonl`));
    for (const p of ps) {
      const prompt = armText(a) + docContext(p);
      s.write(JSON.stringify({ key: `${a}:${p.uid}:1`, request: { contents: [{ parts: [{ text: prompt }, { inlineData: await liteImage(p.uid) }] }], safetySettings: SAFETY, generationConfig: OCR_GENERATION_CONFIG } }) + '\n');
      inTok += Math.ceil(prompt.length / 3.5) + 1100;
    }
    await new Promise((r) => s.end(r));
  }
  const { priceFor, BATCH_MULTIPLIER } = await import('../../lib/model-pricing.mjs');
  const pr = priceFor(MODEL), n = ps.length * ARMS.length, outTok = n * 1500;
  const usd = BATCH_MULTIPLIER * ((inTok / 1e6) * pr.input + (outTok / 1e6) * pr.output);
  fs.writeFileSync(path.join(LITE_CFG.work, 'estimate.json'), JSON.stringify({ at: new Date().toISOString(), model: MODEL, requests: n, in_tokens: inTok, out_tokens_assumed: outTok, usd: +usd.toFixed(4) }, null, 1));
  console.log(`lite-build: ${n} requests; ESTIMATE $${usd.toFixed(4)} (cap $${LITE_CAP_USD})`);
}
async function liteSubmit() {
  const { stageSubmit } = await import('../ocr-v18-ab.mjs');
  await stageSubmit(LITE_CFG);
  const { registerEvalBatch } = await import('../../lib/eval-batch-registry.mjs');
  const rec = J(path.join(LITE_CFG.work, 'batch.json')); const { c, db } = await mongo();
  for (const j of rec.jobs) await registerEvalBatch(db, { jobName: j.job_name, id: `ocr-plain-7966-${j.arm}`, model: j.model, pageCount: j.requests, submittedAt: j.submitted_at, issue: 7966, submittedBy: 'scripts/eval/ocr-plain-7966/run.mjs' });
  await c.close(); console.log('registered', rec.jobs.length);
}
async function litePoll() {
  const { stagePoll, r4 } = await import('../ocr-v18-ab.mjs');
  const done = await stagePoll(LITE_CFG);
  const { closeEvalBatch } = await import('../../lib/eval-batch-registry.mjs');
  const rec = J(path.join(LITE_CFG.work, 'batch.json')); const { c, db } = await mongo();
  for (const j of rec.jobs.filter((x) => x.collected_at && !x.closed)) { await closeEvalBatch(db, j.job_name, { evidence: `${j.responses} responses collected ${j.collected_at}`, usage: { cost_usd: r4(j.cost_usd), input_tokens: j.in_tokens, output_tokens: j.out_tokens } }); j.closed = true; }
  fs.writeFileSync(path.join(LITE_CFG.work, 'batch.json'), JSON.stringify(rec, null, 1)); await c.close();
  const reads = liteReads(); const want = pageList().length * ARMS.length;
  console.log(`lite reads with text: ${[...reads.values()].filter((r) => r.outcome === 'text').length} of ${want}; done=${done}`);
}
/** Unanswered (error / cancelled) lite requests resent once, as a new job per arm ("<arm>r"). */
async function liteRetry() {
  const reads = liteReads(); const rec = J(path.join(LITE_CFG.work, 'batch.json'));
  const arms = [];
  for (const a of ARMS) {
    const lines = fs.readFileSync(path.join(LITE_CFG.work, `requests-${a}.jsonl`), 'utf8').split('\n').filter(Boolean).filter((l) => { const k = JSON.parse(l).key; const r = reads.get(k.split(':').slice(0, 2).join(':')); return !r || r.outcome === 'error'; });
    if (!lines.length || rec.jobs.some((j) => j.arm === `${a}r`)) continue;
    fs.writeFileSync(path.join(LITE_CFG.work, `requests-${a}r.jsonl`), lines.map((l) => { const o = JSON.parse(l); o.key = o.key.replace(/^([^:]+):/, '$1r:'); return JSON.stringify(o); }).join('\n') + '\n');
    arms.push(`${a}r`); console.log(`${a}: ${lines.length} to resend`);
  }
  if (!arms.length) { console.log('nothing to resend'); return; }
  const { stageSubmit } = await import('../ocr-v18-ab.mjs');
  await stageSubmit({ ...LITE_CFG, arms });
  const { registerEvalBatch } = await import('../../lib/eval-batch-registry.mjs');
  const r2 = J(path.join(LITE_CFG.work, 'batch.json')); const { c, db } = await mongo();
  for (const j of r2.jobs.filter((x) => arms.includes(x.arm))) await registerEvalBatch(db, { jobName: j.job_name, id: `ocr-plain-7966-${j.arm}`, model: j.model, pageCount: j.requests, submittedAt: j.submitted_at, issue: 7966, submittedBy: 'scripts/eval/ocr-plain-7966/run.mjs' });
  await c.close();
}
/** arm:uid → the lite read (a resent request's answer replaces an error). */
function liteReads() {
  const m = new Map();
  for (const r of jsonl(path.join(LITE_CFG.work, 'reads.jsonl'))) {
    const arm = r.arm.replace(/r$/, ''), k = `${arm}:${r.uid}`, prev = m.get(k);
    if (!prev || prev.outcome === 'error') m.set(k, { ...r, arm, resent: r.arm.endsWith('r') });
  }
  return m;
}

// ── agy: cli-ocr.mjs's one-page read (sentinels-6523), with the arm's prompt in place of the live one ──
async function agyRead(p, arm) {
  const { agyCall, CLI_SAFE_ARGS, installToolGate, unwrapRead, agyUsage } = await import('../../lib/agy-cli.mjs');
  const { ocrReadProblem, OCR_SENTINEL_INSTRUCTION } = await import('../../lib/cli-chatter.mjs');
  const ws = path.join(OUT, 'agy', arm, p.uid); fs.mkdirSync(ws, { recursive: true });
  const img = path.join(ws, `${p.page_id}.jpg`); fs.copyFileSync(path.join(OUT, 'img', `${p.uid}.jpg`), img);
  const sent = armText(arm) + `\n\nThe page image to transcribe is attached: @./${path.basename(img)} Transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n`;
  const NUDGE = 'Running commands is not available here. Answer directly from the attached file now, following the instructions above exactly.';
  installToolGate(ws);
  const usage = []; let r, nudged = false, rereads = 0, calls = 0, read = null;
  for (;;) {
    r = await agyCall(['-p', sent, '--model', AGY_MODEL, ...CLI_SAFE_ARGS], ws);
    if (r.not_called || r.cls === 'quota') return { quota: true, err: r.err, locked_until: r.locked_until || null };
    calls++; usage.push(agyUsage(r.usage));
    if (r.cls === 'denied_tool' && r.conversation && !nudged) { nudged = true; r = await agyCall(['-p', NUDGE, '--model', AGY_MODEL, ...CLI_SAFE_ARGS, '--conversation', r.conversation], ws); calls++; usage.push(agyUsage(r.usage)); }
    read = unwrapRead(r.text);
    const problem = read.problem || (read.text ? ocrReadProblem(read.text) : 'empty');
    if (problem && rereads < 1 && !r.cls) { rereads++; continue; }
    return { text: read.text || '', problem: problem || null, cls: r.cls || null, calls, rereads, nudged, usage, secs: r.secs, prompt_md5: md5(sent), image_sha256: p.image_sha256 };
  }
}
async function agy() {
  const arms = arg('arm') ? [arg('arm')] : ARMS, conc = +arg('conc', 3);
  const have = new Set(jsonl(F.agy).filter((r) => !r.quota).map((r) => `${r.arm}:${r.uid}`));
  // pages in seeded order, the four arms of a page together (a stop leaves whole pages)
  const jobs = []; for (const p of shuffle(pageList(), makeRng(SEED.queue))) for (const a of arms) if (!have.has(`${a}:${p.uid}`)) jobs.push({ p, a });
  console.log(`agy: ${jobs.length} reads to make`);
  let i = 0, stop = null;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (!stop && i < jobs.length) {
      const { p, a } = jobs[i++];
      const r = await agyRead(p, a);
      if (r.quota) { stop = `quota: ${r.err} ${r.locked_until || ''}`; break; }
      append(F.agy, { arm: a, uid: p.uid, ...r });
      console.log(`  ${a} ${p.uid}: ${r.text.length} chars${r.problem ? ` PROBLEM ${r.problem}` : ''} ${r.secs ?? '?'}s`);
    }
  }));
  console.log(stop ? `STOPPED ${stop}` : 'agy: done', jsonl(F.agy).length, 'rows');
}
/** arm:uid → the agy read (the last row for a key). */
const agyReads = () => new Map(jsonl(F.agy).filter((r) => !r.quota).map((r) => [`${r.arm}:${r.uid}`, r]));

// ── the normalised read the judge sees and CER is scored on ──
// #7941's normaliser (three-way.mjs normalise('ours')), with ONE change fixed in the pre-registration: <note> blocks
// are dropped in every arm (an interpretive note is not page text; #7941 kept them as text, and arm A alone asks for
// them, so keeping them would charge A for the very instruction under test). <term> keeps its words (they are page
// text). <vocab> and <image-desc> are dropped by #7941's rule already; C's bare <image/> by its self-closing rule.
const NOTE = /<note\b[^>]*>[\s\S]*?<\/note>/gi;
async function normRead(text) { const { normalise } = await import('../judge-cal-7866bar-7263/three-way.mjs'); return normalise('ours', { text: String(text || '').replace(NOTE, ' ') }).text; }
function readsOf(engine) { return engine === 'lite' ? new Map([...liteReads()].map(([k, r]) => [k, { text: r.outcome === 'text' || r.outcome === 'truncated' ? r.text : '', outcome: r.outcome, out_tokens: r.outTok }])) : new Map([...agyReads()].map(([k, r]) => [k, { text: r.problem ? '' : r.text, outcome: r.problem ? `problem: ${r.problem}` : 'text', out_tokens: (r.usage || []).reduce((s, u) => s + (u?.output_tokens ?? u?.output ?? 0), 0) }])); }

// ── stage judge ──
async function judge() {
  const { judgeAbsolute, paceCheck } = await import('../confidence-7866/lib.mjs');
  const limits = await import('../../lib/model-limits.mjs');
  const V = jsonl(F.verdicts), byText = new Map(V.filter((r) => r.verdict).map((r) => [r.text_sha, r]));
  const done = new Set(V.filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of V) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const reads = Object.fromEntries(ENGINES.map((e) => [e, readsOf(e)]));
  const jobs = [];
  for (const p of shuffle(pageList(), makeRng(SEED.queue))) for (const e of ENGINES) for (const a of shuffle(ARMS, makeRng(SEED.queue + parseInt(sha(p.uid + e).slice(0, 6), 16)))) {
    const r = reads[e].get(`${a}:${p.uid}`); if (!r) continue;
    const id = `${e}-${a}-${p.uid}`; if (done.has(id) || (tries.get(id) ?? 0) >= 3) continue;
    jobs.push({ id, e, a, p, text: await normRead(r.text) });
  }
  const spent = () => jsonl(F.verdicts).filter((r) => (r.verdict || r.usage) && !r.reused_from).length;
  console.log(`judge: ${jobs.length} texts to judge; Opus so far ${spent()}`);
  let i = 0, stop = null; const state = {};
  await Promise.all(Array.from({ length: +arg('conc', 4) }, async () => {
    while (!stop && i < jobs.length) {
      if (spent() >= OPUS_CAP) { stop = `Opus cap ${OPUS_CAP}`; break; }
      const why = await paceCheck(limits, state); if (why) { stop = why; break; }
      const j = jobs[i++]; const ts = sha(j.text).slice(0, 16);
      if (!j.text.trim()) { append(F.verdicts, { id: j.id, engine: j.e, arm: j.a, uid: j.p.uid, text_sha: ts, empty: true, verdict: { accept: false, fidelity: 0, defects: [{ class: 'O5', severity: 'wrong_text', what: 'empty read' }] } }); continue; }
      const prev = byText.get(ts);
      if (prev) { append(F.verdicts, { id: j.id, engine: j.e, arm: j.a, uid: j.p.uid, text_sha: ts, reused_from: prev.id, verdict: prev.verdict, model: prev.model }); console.log(`  ${j.id}: identical text to ${prev.id}, verdict reused`); continue; }
      try {
        const r = await judgeAbsolute({ lang: j.p.lang, text: j.text }, fs.readFileSync(path.join(OUT, 'img', `${j.p.uid}.jpg`)).length > 4e6 ? await shrink(j.p.uid) : fs.readFileSync(path.join(OUT, 'img', `${j.p.uid}.jpg`)));
        if (r.cls === 'quota') { stop = 'quota reply'; break; }
        const row = { id: j.id, engine: j.e, arm: j.a, uid: j.p.uid, text_sha: ts, ...r }; append(F.verdicts, row); if (r.verdict) byText.set(ts, row);
        console.log(`  ${j.id}: ${r.verdict ? `accept=${r.verdict.accept} severe=${(r.verdict.defects || []).filter(severe).length}` : 'UNPARSED ' + (r.cls || '')} ${r.secs}s`);
      } catch (e) { console.log(`  ${j.id} ERR ${String(e.message).slice(0, 160)}`); }
    }
  }));
  console.log(stop ? `STOPPED: ${stop}` : 'judge: done', `Opus calls ${spent()}; meter ${JSON.stringify(state.meter ?? null)}`);
}
async function shrink(uid) { const sharp = (await import('sharp')).default; return sharp(fs.readFileSync(path.join(OUT, 'img', `${uid}.jpg`))).resize(3000, 3000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(); }
// A read the lane does not serve (lite: RECITATION / no text; agy: cli-ocr's guard refuses it, never written) counts as
// an empty page: not accepted, one wrong_text flag (pre-registration, measure 1).
const EMPTY_VERDICT = { empty: true, verdict: { accept: false, fidelity: 0, defects: [{ class: 'O5', severity: 'wrong_text', what: 'empty read' }] } };
const severe = (d) => d.severity === 'misleads' || d.severity === 'wrong_text';

// ── stage score ──
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
function cerChars(refLines, text) {   // three-way.mjs cerChars (not exported there)
  const C = flat(text); let edits = 0, chars = 0;
  for (const l of refLines) { const L = flat(l); const n = L.replace(/ /g, '').length; if (!n) continue; edits += windowedErrorRate(L, C).windowedCer * n; chars += n; }
  return chars ? Math.min(1, edits / chars) : 0;
}
/** Omitted lines: reference lines (>= 15 letters, normalizeForScript latin) whose windowed CER inside the read's body
 *  is > 0.5, i.e. the line is not there. Marginalia: the same over the typed page's notes (set A, DTA / EEBO / CAMENA
 *  carry marginal notes as notes), located in the WHOLE read (margins are tagged, so not in bodyText). */
function omitted(lines, text) {
  const T = normalizeForScript(String(text || ''), 'latin'); let n = 0, miss = 0;
  for (const l of lines) { const L = normalizeForScript(l, 'latin'); if (L.replace(/ /g, '').length < 15) continue; n++; if (windowedErrorRate(L, T).windowedCer > 0.5) miss++; }
  return { n, miss };
}
function boot(pages, stat, B = 2000, seed = SEED.boot) {
  const rng = makeRng(seed), xs = [];
  for (let k = 0; k < B; k++) { const s = []; for (let i = 0; i < pages.length; i++) s.push(pages[Math.floor(rng() * pages.length)]); const v = stat(s); if (v != null && Number.isFinite(v)) xs.push(v); }
  xs.sort((a, b) => a - b); return xs;
}
const q = (xs, p) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);
const r3 = (x) => (x == null ? null : +x.toFixed(3));
async function score() {
  const ps = pageList(), V = new Map(jsonl(F.verdicts).filter((r) => r.verdict).map((r) => [r.id, r]));
  const rows = [];
  for (const e of ENGINES) {
    const reads = readsOf(e);
    for (const p of ps) for (const a of ARMS) {
      const r = reads.get(`${a}:${p.uid}`); if (!r) continue;
      const it = itemOf(p.uid), raw = r.text || '', v = raw.trim() ? V.get(`${e}-${a}-${p.uid}`) : EMPTY_VERDICT;
      const row = { engine: e, arm: a, uid: p.uid, set: p.set, lang: p.lang, outcome: r.outcome, out_tokens: r.out_tokens ?? null, chars: raw.length,
        n_note: (raw.match(/<note\b/gi) || []).length, n_vocab: (raw.match(/<vocab\b/gi) || []).length, n_term: (raw.match(/<term\b/gi) || []).length, n_image_desc: (raw.match(/<image-desc\b/gi) || []).length, n_image_marker: (raw.match(/<image\s*\/>/gi) || []).length, n_margin: (raw.match(/<margin\b/gi) || []).length };
      if (p.set === 'Z') {
        const t = truthHan(raw.replace(NOTE, ' '), it.pbs, it.k);
        Object.assign(row, { units: it.pbs[it.k].text.length, unit: 'Han characters of the Kanripo leaf', cer: t.cer, miss: null, extra: null, spans: t.spans.length, omitted_share: t.omitted ?? null });
      } else {
        const t = truthLatin(raw.replace(NOTE, ' '), it.ref, it.win);
        const refNorm = (await import('../judge-cal-7866bar-7263/three-way.mjs')).universal([it.ref.text, ...(it.ref.notes || [])].join('\n'));
        const norm = await normRead(raw);
        const ol = omitted(it.ref.text.split('\n'), bodyText(raw.replace(NOTE, ' '))), om = omitted(it.ref.notes || [], raw.replace(NOTE, ' ').replace(/<[^<>]*>/g, ' '));
        Object.assign(row, { units: normalizeForScript(refNorm, 'latin').split(' ').filter(Boolean).length, unit: 'words of the typed reference', miss: t.miss, extra: t.extra, spans: t.spans.length,
          cer_norm: r3(cerChars(refNorm.split('\n'), norm)), ref_chars: flat(refNorm).replace(/ /g, '').length, ref_lines: ol.n, lines_omitted: ol.miss, ref_notes: om.n, notes_omitted: om.miss });
      }
      if (v) { const defs = v.verdict.defects || []; Object.assign(row, { judged: true, reused: !!v.reused_from, accept: !!v.verdict.accept, judge_bad: !v.verdict.accept || defs.some((d) => d.severity === 'wrong_text'), severe: defs.filter(severe).length, omission_flags: defs.filter((d) => severe(d) && /^O5|^O12/.test(String(d.class || ''))).length, classes: defs.filter(severe).map((d) => d.class) }); }
      rows.push(row);
    }
  }
  // per engine: only pages where all four arms were read AND judged
  const out = { generated_at: new Date().toISOString(), issue: 7966, prereg: 'scripts/eval/ocr-plain-7966/PREREGISTRATION.md', prompts: J(path.join(RESULTS, 'prompts.json')), engines: {} };
  const rate = (num, den, k = 1000) => (s) => { const d = s.reduce((x, r) => x + den(r), 0); return d ? (k * s.reduce((x, r) => x + num(r), 0)) / d : null; };
  const MEAS = {
    severe_per_1k: rate((r) => r.severe, (r) => r.units),
    judge_bad: (s) => s.filter((r) => r.judge_bad).length / s.length,
    lines_omitted_per_100: rate((r) => r.lines_omitted ?? 0, (r) => r.ref_lines ?? 0, 100),
    notes_omitted_per_100: rate((r) => r.notes_omitted ?? 0, (r) => r.ref_notes ?? 0, 100),
    miss: rate((r) => (r.miss ?? r.cer ?? 0) * r.units, (r) => r.units, 1),
    extra: rate((r) => (r.extra ?? 0) * r.units, (r) => (r.extra == null ? 0 : r.units), 1),
    cer_norm: rate((r) => (r.cer_norm ?? 0) * (r.ref_chars ?? 0), (r) => r.ref_chars ?? 0, 1),
    out_tokens: (s) => s.reduce((x, r) => x + (r.out_tokens ?? 0), 0) / s.length,
    out_tokens_median: (s) => { const v = s.map((r) => r.out_tokens ?? 0).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; },
  };
  const IDX = new Map(rows.map((r) => [`${r.engine}|${r.arm}|${r.uid}`, r])); const row1 = (e, a, uid) => IDX.get(`${e}|${a}|${uid}`);
  for (const e of ENGINES) {
    const full = ps.filter((p) => ARMS.every((a) => row1(e, a, p.uid)?.judged));
    const eo = out.engines[e] = { n_pages: full.length, by_lang: {} };
    // ANSWERED (reported, not decided on): the pages where this engine served text in all four arms
    const answered = (p) => ARMS.every((a) => { const r = row1(e, a, p.uid); return r?.chars > 0 && ['text', 'truncated'].includes(String(r.outcome)); });
    for (const lang of ['ALL', 'ANSWERED', 'English', 'Latin', 'German', 'Chinese']) {
      const P = full.filter((p) => lang === 'ALL' || (lang === 'ANSWERED' ? answered(p) : p.lang === lang)); if (!P.length) continue;
      const R = (a, sub) => sub.map((p) => row1(e, a, p.uid));
      const L = eo.by_lang[lang] = { n: P.length, arms: {}, diffs: {} };
      for (const a of ARMS) L.arms[a] = Object.fromEntries(Object.entries(MEAS).map(([m, f]) => [m, r3(f(R(a, P)))]));
      L.arms.A.counts = { note: R('A', P).reduce((s, r) => s + r.n_note, 0), vocab: R('A', P).reduce((s, r) => s + r.n_vocab, 0), term: R('A', P).reduce((s, r) => s + r.n_term, 0), image_desc: R('A', P).reduce((s, r) => s + r.n_image_desc, 0) };
      for (const x of ['A2', 'B', 'C']) {
        L.diffs[`${x}-A`] = {};
        for (const [m, f] of Object.entries(MEAS)) {
          const d = (sub) => { const u = f(R(x, sub)), v = f(R('A', sub)); return u == null || v == null ? null : u - v; };
          const xs = boot(P, d);
          L.diffs[`${x}-A`][m] = { diff: r3(d(P)), ci95: [r3(q(xs, 0.025)), r3(q(xs, 0.975))], abs_q95: r3(q(xs.map(Math.abs).sort((a, b) => a - b), 0.95)) };
        }
      }
    }
    // the pre-registered rule, on ALL pages of the engine
    const D = eo.by_lang.ALL?.diffs; if (!D) continue;
    const margin = Math.max(0.5, D['A2-A'].severe_per_1k.abs_q95), omMargin = Math.max(1.0, D['A2-A'].lines_omitted_per_100.abs_q95), noteMargin = Math.max(2.0, D['A2-A'].notes_omitted_per_100.abs_q95);
    eo.rule = { margin_severe_per_1k: r3(margin), margin_lines_omitted_per_100: r3(omMargin), margin_notes_omitted_per_100: r3(noteMargin) };
    for (const x of ['B', 'C']) {
      const s = D[`${x}-A`];
      const nonInf = s.severe_per_1k.ci95[1] <= margin, noOm = s.lines_omitted_per_100.diff <= omMargin && s.notes_omitted_per_100.diff <= noteMargin;
      eo.rule[x] = { non_inferior_severe: nonInf, no_omission_rise: noOm, passes: nonInf && noOm, superior_severe: s.severe_per_1k.ci95[1] < 0 };
    }
  }
  out.lite_spend = fs.existsSync(path.join(LITE_CFG.work, 'batch.json')) ? J(path.join(LITE_CFG.work, 'batch.json')).jobs.map((j) => ({ arm: j.arm, job: j.job_name, responses: j.responses, outcomes: j.outcomes, in_tokens: j.in_tokens, out_tokens: j.out_tokens, cost_usd: j.cost_usd })) : null;
  out.opus_calls = jsonl(F.verdicts).filter((r) => (r.verdict || r.usage) && !r.reused_from && !r.empty).length;
  out.verdicts_reused_identical_text = jsonl(F.verdicts).filter((r) => r.reused_from).length;
  fs.writeFileSync(path.join(RESULTS, 'score.json'), JSON.stringify(out, null, 1) + '\n');
  fs.writeFileSync(path.join(RESULTS, 'pages.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  for (const e of ENGINES) for (const [lang, L] of Object.entries(out.engines[e]?.by_lang || {})) {
    console.log(`\n${e} ${lang} n=${L.n}`);
    for (const a of ARMS) console.log(' ', a.padEnd(3), JSON.stringify(L.arms[a]));
    for (const [k, d] of Object.entries(L.diffs)) console.log(' ', k, 'severe', JSON.stringify(d.severe_per_1k), 'lines', JSON.stringify(d.lines_omitted_per_100), 'tok', d.out_tokens.diff);
  }
  for (const e of ENGINES) console.log(e, JSON.stringify(out.engines[e]?.rule));
}

async function show() {
  const [uid, e, a] = process.argv.slice(3); const r = readsOf(e).get(`${a}:${uid}`);
  console.log(r ? await normRead(r.text) : 'no such read');
}

const stages = { pages, prompts, 'lite-build': liteBuild, 'lite-submit': liteSubmit, 'lite-poll': litePoll, 'lite-retry': liteRetry, agy, judge, score, show };
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}
