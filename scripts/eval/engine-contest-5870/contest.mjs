#!/usr/bin/env node
// PRIOR ART: scripts/eval/routing-eval.mjs — seal / arms / score / decide for an engine-vs-engine OCR eval, but its
// seal draws a fresh population from Mongo and its arms are Gemini OCR; this run reuses the #5700 A5 pages and their
// stored Flash re-reads, and scores the ENGLISH, so only its `decide` (and the rule library) is reused, via a
// routing-eval-shaped results.json. scripts/eval/reocr-lift-5700/pilot.mjs — the A5 chain (read, translate with
// prompt v13, never write a page), realtime only; its translate request is copied here onto the Batch API.
// scripts/workers/syriac-kraken-lane.mjs — the Kraken invocation for right-to-left script, copied.
/** #5870 engine contest: open OCR engines (Kraken) vs the A5 Flash re-read, scored by the Lite English against a human reference. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/engine-contest-5870/contest.mjs <stage>
 *
 *   seal      $0. The registered pages (runs/engine-contest-5870.json) from the A5 files; image fetched as A5 sent it,
 *             sha256 pinned → results/engine-contest-5870/sealed.json. No Mongo.
 *   kraken    $0, CPU. Refuses while the run file, the rule or sealed.json is uncommitted (the preregistration).
 *             → <work>/out/kraken/<slug>.json. Resumable. nice -n 19, one page at a time per --lane (greek|arab).
 *   submit    PAID (Batch). Lite v13 translation of each Kraken read; refuses without the `engine-contest-5870`
 *             envelope, above --cap-usd, or if the live default translation prompt is not A5's v13.
 *   collect   polls the Batch job(s) (--wait-min M), meters each to gemini_usage under the pseudo book id.
 *   records   harness records (source = corrected transcription; candidates served / flash / kraken English).
 *             Private references are read from the #5695 track archive (--private), so --out goes OUTSIDE the repo.
 *   results   harness results.json → routing-eval results.json (fidelity + catastrophic per arm per page).
 *   lift      $0. Lift over today's English per script and served engine, page-points per $1K, Kraken wall clock,
 *             the A5 plan repriced → results/engine-contest-5870/lift.json.
 * Writes nothing to books or pages.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const argv = process.argv.slice(2); const STAGE = argv[0];
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const RUN_FILE = 'scripts/eval/routing-eval/runs/engine-contest-5870.json';
const RUN = JSON.parse(fs.readFileSync(RUN_FILE, 'utf8'));
const A5 = 'scripts/eval/results/reocr-lift-2026-10';
const RES = RUN.results_dir; const WORK = opt('work', RUN.work_dir);
const SCOPE = 'engine-contest-5870'; const PSEUDO_BOOK = SCOPE; const ENDPOINT = 'scripts/eval/engine-contest-5870/contest.mjs';
const TR_MODEL = 'gemini-3.1-flash-lite'; const V13_HASH = '516510147237b6a79d9d3f6e797bba7f';
const KRAKEN_BIN = '/root/bench2-kraken/venv/bin/kraken';
const MODELS = {
  greek: { file: '/root/.local/share/htrmopo/a328a8d1-29fb-519a-bf81-3f56a512f080/ppocr_v6_tau090.safetensors', name: 'greek-cllg', doi: '10.5281/zenodo.22232579', licence: 'CC-BY-4.0', rtl: false },
  persian: { file: '/root/.local/share/htrmopo/a4e5e69f-9346-55e7-9769-d96e3d894187/persian_best.mlmodel', name: 'openiti-persian_best', doi: '10.5281/zenodo.7051644', licence: 'CC0-1.0', rtl: true },
  arabic: { file: '/root/.local/share/htrmopo/b4a70336-339f-508b-abf4-24b698091dd7/arabic_best.mlmodel', name: 'openiti-arabic_best', doi: '10.5281/zenodo.7050296', licence: 'CC0-1.0', rtl: true },
};
const rl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1) + '\n'); };
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const W = (...p) => path.join(WORK, ...p);
function committed(file) {
  try { execFileSync('git', ['ls-files', '--error-unmatch', file], { stdio: 'pipe' }); } catch { return false; }
  return execFileSync('git', ['status', '--porcelain', '--', file]).toString().trim() === '';
}
function preregistered() {
  const files = [RUN_FILE, ...RUN.rules, `${RES}/sealed.json`].filter((f) => !committed(f));
  if (files.length) { console.error(`not committed, so not preregistered — commit before any engine runs:\n  ${files.join('\n  ')}`); process.exit(2); }
}

// ── seal ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function seal() {
  const { fetchImageBase64 } = await import('../ocr-v18-ab.mjs');
  const lift = readJson(`${A5}/lift.json`).pages; const en = Object.fromEntries(rl(`${A5}/enriched.jsonl`).map((x) => [x.id, x]));
  const reocr = Object.fromEntries(rl(`${A5}/reocr.jsonl`).filter((x) => x.arm === 'reocr').map((x) => [x.id, x]));
  const groupOf = (p) => {
    if (p.manuscript || p.lite_reocr == null) return null;
    const year = en[p.id]?.book?.year;
    if (p.script === 'Greek') return typeof year === 'number' && year <= 1699 ? 'greek-print-le1699' : null;
    if (p.script === 'Persian' || p.script === 'Arabic') return 'arabic-script-print';
    return null;
  };
  const pages = lift.filter(groupOf).sort((a, b) => a.id.localeCompare(b.id));
  fs.mkdirSync(W('images'), { recursive: true }); const sealed = [];
  const k = {};
  for (const p of pages) {
    const g = groupOf(p); const e = en[p.id]; const pre = g === 'greek-print-le1699' ? 'grc' : p.script === 'Persian' ? 'fas' : 'ara'; k[pre] = (k[pre] || 0) + 1;
    const slug = `${pre}-${String(k[pre]).padStart(2, '0')}`;
    const img = await fetchImageBase64(e.image); const buf = Buffer.from(img.data, 'base64');
    fs.writeFileSync(W('images', `${slug}.jpg`), buf);
    sealed.push({ slug, family: g, id: p.id, book_id: e.book_id, page_number: e.page_number, page_id: e.page_id, script: p.script, lang: p.lang, model_key: p.script === 'Greek' ? 'greek' : p.script.toLowerCase(),
      title: e.book.title, year: e.book.year, served_engine: p.served_engine, flash_read_outcome: reocr[p.id]?.outcome ?? null, flash_read_bytes_sent: reocr[p.id]?.image_bytes_sent ?? null,
      image: e.image, image_mime: img.mimeType, image_bytes: buf.length, image_sha256: sha256(buf) });
    console.log(slug, p.id, p.script, e.book.year, buf.length, reocr[p.id]?.image_bytes_sent === buf.length ? 'bytes = A5' : `A5 sent ${reocr[p.id]?.image_bytes_sent}`);
  }
  writeJson(`${RES}/sealed.json`, { issue: 5870, run_id: RUN.run_id, sealed_at: new Date().toISOString(), groups: Object.fromEntries(Object.keys(RUN.population.groups).map((g) => [g, sealed.filter((s) => s.family === g).length])), sealed });
}

// ── kraken ────────────────────────────────────────────────────────────────────────────────────────────────────
function kraken() {
  preregistered();
  const pinFile = `${RES}/prompt.json`;
  if (!fs.existsSync(pinFile)) writeJson(pinFile, { rules: Object.fromEntries(RUN.rules.map((f) => [f, sha256(fs.readFileSync(f))])), pinned_at: new Date().toISOString(), pinned_by: 'contest.mjs kraken, before the first engine read' });
  const lane = opt('lane', 'all'); const sealed = readJson(`${RES}/sealed.json`).sealed.filter((p) => lane === 'all' || (lane === 'greek') === (p.model_key === 'greek'));
  for (const p of sealed) {
    const f = W('out', 'kraken', `${p.slug}.json`); if (fs.existsSync(f)) continue;
    const img = W('images', `${p.slug}.jpg`); if (sha256(fs.readFileSync(img)) !== p.image_sha256) throw new Error(`${p.slug}: image bytes differ from the seal`);
    const m = MODELS[p.model_key]; const txt = W('out', 'kraken', `${p.slug}.txt`); fs.mkdirSync(path.dirname(f), { recursive: true });
    const args = ['-n', '19', 'timeout', '900', KRAKEN_BIN, '-i', img, txt, 'segment', '-bl', ...(m.rtl ? ['-d', 'horizontal-rl'] : []), 'ocr', '-m', m.file, ...(m.rtl ? ['--base-dir', 'R'] : [])];
    const t0 = Date.now(); const r = spawnSync('nice', args, { encoding: 'utf8', maxBuffer: 64 << 20 }); const seconds = (Date.now() - t0) / 1000;
    const text = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : '';
    const finishReason = r.status === 124 ? 'TIMEOUT' : r.status !== 0 ? `ERROR_${r.status}` : text.trim() ? 'STOP' : 'EMPTY';
    writeJson(f, { slug: p.slug, arm: 'kraken', model: `kraken/${m.name}`, text, finishReason, seconds: +seconds.toFixed(1), image_sha256: p.image_sha256,
      engine: { name: 'kraken', version: '7.1', model: m.name, model_doi: m.doi, licence: m.licence, segmenter: 'blla default baseline', direction: m.rtl ? 'horizontal-rl' : 'horizontal-lr', base_dir: m.rtl ? 'R' : 'L' },
      stderr_tail: (r.stderr || '').slice(-400), at: new Date().toISOString() });
    console.log(`${p.slug} ${finishReason} ${seconds.toFixed(0)} s ${text.length} chars`);
  }
}

// ── translate (Batch) ─────────────────────────────────────────────────────────────────────────────────────────
const API = 'https://generativelanguage.googleapis.com';
const BATCH_REC = () => W('batch.json');
async function mongo() { const { MongoClient } = await import('mongodb'); const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); return c; }
async function envelope(db) {
  const { getScopeSpendUsd } = await import('../../lib/spend-guard.mjs');
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const env = control?.allow_scopes?.[SCOPE];
  if (!env?.budget_usd) { console.error(`no ${SCOPE} envelope — create it with set-scope.mjs first`); process.exit(2); }
  const m = await getScopeSpendUsd(db, { ids: [PSEUDO_BOOK], since: new Date(env.created_at) });
  if (m.meterError) { console.error(`envelope meter unreadable (${m.meterError}) — refusing`); process.exit(2); }
  return { budget: Math.min(Number(opt('cap-usd', 5)), env.budget_usd), measured: m.usd };
}
const krakenText = (slug) => { const f = W('out', 'kraken', `${slug}.json`); if (!fs.existsSync(f)) return null; const j = readJson(f); return j.finishReason === 'STOP' && j.text.trim() ? j.text : null; };

async function submit() {
  preregistered();
  const { buildTranslationPrompt, loadTranslationPrompts, SAFETY_SETTINGS } = await import('../../lib/translate-core.mjs');
  const { priceFor, BATCH_MULTIPLIER } = await import('../../lib/model-pricing.mjs');
  const { createThenDeleteInput } = await import('../../lib/gemini-batch-input-file.mjs');
  const c = await mongo(); const db = c.db('bookstore');
  try {
    const env = await envelope(db); const prompts = await loadTranslationPrompts(db);
    if (prompts.translation.ref.content_hash !== V13_HASH) throw new Error(`live default translation prompt is v${prompts.translation.ref.version} ${prompts.translation.ref.content_hash}, not A5's v13 — refusing`);
    const rec = fs.existsSync(BATCH_REC()) ? readJson(BATCH_REC()) : { jobs: [] };
    // In flight or answered: never sent twice. A dead job's unanswered slugs go again.
    const done = new Set(rec.jobs.flatMap((j) => (j.collected_at ? j.keys_answered || [] : j.slugs)));
    const sealed = readJson(`${RES}/sealed.json`).sealed; const reqs = [];
    for (const p of sealed) {
      const text = krakenText(p.slug); if (!text || done.has(p.slug)) continue;
      const book = await db.collection('books').findOne({ id: p.book_id }, { projection: { title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, image_source: 1 } });
      const ocrText = text.trim(); const { prompt, promptRef } = buildTranslationPrompt({ prompts, book, ocrText, previousTranslation: null });
      reqs.push({ slug: p.slug, src_chars: ocrText.length, promptRef, line: { key: p.slug, request: { contents: [{ parts: [{ text: prompt }] }], safetySettings: SAFETY_SETTINGS,
        generationConfig: { temperature: 0, maxOutputTokens: Math.min(32768, Math.max(4096, ocrText.length + 1200)), thinkingConfig: { thinkingBudget: 0 } } } } });
    }
    if (!reqs.length) { console.log('nothing to submit'); return; }
    const pr = priceFor(TR_MODEL); const est = reqs.reduce((s, r) => s + BATCH_MULTIPLIER * (((r.src_chars / 2 + 2500) / 1e6) * pr.input + ((r.src_chars / 1.5 + 500) / 1e6) * pr.output), 0);
    console.log(`${reqs.length} requests, estimate $${est.toFixed(4)} (Batch); envelope $${env.measured.toFixed(4)} / $${env.budget}`);
    if (env.measured + est >= env.budget) throw new Error('estimate would cross the envelope — refusing');
    const key = process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY'; const apiKey = process.env[key];
    const jsonl = reqs.map((r) => JSON.stringify(r.line)).join('\n'); const bytes = Buffer.byteLength(jsonl);
    const start = await fetch(`${API}/upload/v1beta/files?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'text/plain' }, body: JSON.stringify({ file: { display_name: `${SCOPE}-${rec.jobs.length}` } }) });
    if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
    const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: jsonl });
    if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
    const fileName = (await up.json()).file?.name;
    const job = await createThenDeleteInput({ fileName, apiKey, create: async () => {
      const r = await fetch(`${API}/v1beta/models/${TR_MODEL}:batchGenerateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch: { display_name: `${SCOPE}-${rec.jobs.length}`, input_config: { file_name: fileName } } }) });
      if (!r.ok) throw new Error(`batch create ${r.status} ${(await r.text()).slice(0, 500)}`); return r.json(); } });
    rec.key_env = key; rec.jobs.push({ job_name: job.name, requests: reqs.length, slugs: reqs.map((r) => r.slug), prompt_ref: reqs[0].promptRef, estimate_usd: +est.toFixed(5), submitted_at: new Date().toISOString() });
    writeJson(BATCH_REC(), rec); console.log(`submitted ${job.name}`);
  } finally { await c.close(); }
}

async function collect() {
  const { costOf, BATCH_MULTIPLIER } = await import('../../lib/model-pricing.mjs');
  const { sanitizeTranslationTags } = await import('../../lib/translate-core.mjs');
  const { logUsage } = await import('../../workers/lib/supabase-usage-logger.mjs');
  const rec = readJson(BATCH_REC()); const apiKey = process.env[rec.key_env]; const waitMax = Number(opt('wait-min', 0)) * 60e3; const t0 = Date.now();
  for (;;) {
    let pending = 0;
    for (const j of rec.jobs) {
      if (j.collected_at) continue;
      const data = await (await fetch(`${API}/v1beta/${j.job_name}?key=${apiKey}`)).json(); const state = data.metadata?.state || data.state;
      const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
      if (!rf && /FAILED|CANCELLED|EXPIRED/.test(state || '')) { Object.assign(j, { collected_at: new Date().toISOString(), state, keys_answered: [], dead: JSON.stringify(data.error || '').slice(0, 200) }); writeJson(BATCH_REC(), rec); continue; }
      if (!rf) { pending++; console.log(`${j.job_name} ${state}`); continue; }
      const text = await (await fetch(`${API}/download/v1beta/${rf}:download?alt=media&key=${apiKey}`)).text();
      let inTok = 0, outTok = 0; const answered = [];
      for (const line of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(line); const slug = r.key || r.metadata?.key; const resp = r.response; const u = resp?.usageMetadata || {};
        const f = W('tr', 'lite-kraken', `${slug}.json`); fs.mkdirSync(path.dirname(f), { recursive: true });
        if (r.error || !resp) { writeJson(f.replace(/\.json$/, '.failed.json'), { slug, error: JSON.stringify(r.error || 'no response').slice(0, 300) }); continue; }
        const out = (resp.candidates?.[0]?.content?.parts || []).filter((x) => x.text && !x.thought).map((x) => x.text).join('');
        const i = u.promptTokenCount || 0, o = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0); inTok += i; outTok += o;
        writeJson(f, { slug, arm: 'lite-kraken', model: TR_MODEL, mode: 'batch', text: sanitizeTranslationTags(out), finishReason: resp.candidates?.[0]?.finishReason ?? null, inputTokens: i, outputTokens: o,
          cost_usd_batch: +(BATCH_MULTIPLIER * costOf(TR_MODEL, i, o)).toFixed(6), prompt_ref: j.prompt_ref, batch_job: j.job_name });
        answered.push(slug);
      }
      const cost = +(BATCH_MULTIPLIER * costOf(TR_MODEL, inTok, outTok)).toFixed(6);
      await logUsage({ type: 'eval', mode: 'batch', model: TR_MODEL, book_id: PSEUDO_BOOK, page_count: answered.length, input_tokens: inTok, output_tokens: outTok, cost_usd: cost, batch_job_id: j.job_name, endpoint: ENDPOINT, triggered_by: 'manual', prompt_version: `v${j.prompt_ref.version}` });
      Object.assign(j, { collected_at: new Date().toISOString(), state, keys_answered: answered, in_tokens: inTok, out_tokens: outTok, cost_usd: cost });
      writeJson(BATCH_REC(), rec); console.log(`collected ${j.job_name}: ${answered.length}/${j.requests}, $${cost}`);
    }
    if (!pending) return;
    if (Date.now() - t0 > waitMax) { console.log(`${pending} job(s) pending; run collect again`); return; }
    await new Promise((ok) => setTimeout(ok, 60e3));
  }
}

// ── harness records ───────────────────────────────────────────────────────────────────────────────────────────
function records() {
  const out = opt('out'); if (!out) { console.error('--out <path outside the repo> is required'); process.exit(2); }
  const priv = {}; for (const f of argv.flatMap((a, i) => (a === '--private' ? [argv[i + 1]] : []))) for (const r of rl(f)) if (r.reference_text) priv[`${r.book_id}_${String(r.page_number).padStart(5, '0')}`] = r.reference_text;
  const tp = Object.fromEntries(rl(`${A5}/track-pages.jsonl`).map((r) => [r.id, r]));
  const tr = {}; for (const t of rl(`${A5}/translations.jsonl`)) (tr[t.id] ||= {})[t.arm] = t;
  const rows = []; const sealed = readJson(`${RES}/sealed.json`).sealed;
  for (const p of sealed) {
    const r = tp[p.id]; const ref = r.reference_text || priv[p.id]; if (!ref) throw new Error(`${p.id}: no reference text (pass the track archive with --private)`);
    const kf = W('tr', 'lite-kraken', `${p.slug}.json`); const k = fs.existsSync(kf) ? readJson(kf) : null;
    // A read with no usable text has no English: it is shown as an empty candidate and scored 1 in `results` (registered).
    const m = r.reference_meta; const style = ['literal', 'free', 'early-modern'].includes(m.style) ? m.style : 'literal';
    const cands = [{ arm: 'served', text: tr[p.id]['lite-ocr']?.text }, { arm: 'flash', text: tr[p.id]['lite-reocr']?.text }, { arm: 'kraken', text: k?.text }].filter((c) => c.text?.trim());
    rows.push({ track: r.track, lang: r.lang, book_id: r.book_id, page_number: r.page_number, slug: p.slug, source_text: r.corrected_text, source_is: 'corrected transcription (by eye, #5695)',
      reference_text: ref, reference_meta: { ...m, translator: m.translator || 'unknown', licence: m.private ? 'in-copyright' : (m.licence || 'unrecorded'), private: !!m.private, style, canonical: !!m.canonical }, candidates: cands });
  }
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
  console.log(`${rows.length} records (${rows.filter((r) => r.reference_meta.private).length} private), kraken English on ${rows.filter((r) => r.candidates.some((c) => c.arm === 'kraken')).length} → ${out}`);
}

// ── routing-eval results ──────────────────────────────────────────────────────────────────────────────────────
function results() {
  const H = readJson(opt('harness', `${RES}/harness-results.json`)); const sealed = readJson(`${RES}/sealed.json`).sealed;
  const byId = Object.fromEntries(H.per_page.map((x) => [x.id, x]));
  const fills = (pp, arm) => Object.values(pp?.arms?.[arm]?.by_judge || {}).some((z) => (z?.invention || []).some((i) => i.kind === 'unreadable_fill'));
  const pages = sealed.map((p) => {
    const pp = byId[p.id]; const k = fs.existsSync(W('out', 'kraken', `${p.slug}.json`)) ? readJson(W('out', 'kraken', `${p.slug}.json`)) : null;
    const kOk = k?.finishReason === 'STOP' && k.text.trim() && pp?.arms?.kraken?.fidelity != null;
    const fid = { flash: pp?.arms?.flash?.fidelity ?? null, kraken: kOk ? pp.arms.kraken.fidelity : 1, served: pp?.arms?.served?.fidelity ?? null };
    return { slug: p.slug, family: p.family, id: p.id, book_id: p.book_id, page_number: p.page_number, script: p.script, served_engine: p.served_engine, page_class: 'text', label_ok: 'yes',
      fidelity: fid, arms: { flash: { catastrophic: fills(pp, 'flash') ? 'unreadable_fill' : null }, kraken: { catastrophic: !kOk ? 'no_read' : fills(pp, 'kraken') ? 'unreadable_fill' : null, finishReason: k?.finishReason ?? null, seconds: k?.seconds ?? null, chars: k?.text?.length ?? 0 } } };
  });
  const families = Object.fromEntries(Object.keys(RUN.population.groups).map((g) => [g, { sealed: pages.filter((x) => x.family === g).length, with_text: pages.filter((x) => x.family === g).length, adjudication: null }]));
  // The reads and the English, committed beside the verdict (no reference text in either).
  const outs = sealed.map((p) => { const f = W('out', 'kraken', `${p.slug}.json`); return fs.existsSync(f) ? readJson(f) : { slug: p.slug, finishReason: 'MISSING' }; });
  fs.writeFileSync(`${RES}/outputs-kraken.jsonl`, outs.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const trs = sealed.map((p) => { const f = W('tr', 'lite-kraken', `${p.slug}.json`); return fs.existsSync(f) ? readJson(f) : null; }).filter(Boolean);
  fs.writeFileSync(`${RES}/translations-kraken.jsonl`, trs.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const rec = readJson(BATCH_REC());
  writeJson(`${RES}/spend.json`, { envelope: SCOPE, pseudo_book_id: PSEUDO_BOOK, model: TR_MODEL, mode: 'batch', jobs: rec.jobs.map(({ job_name, requests, keys_answered, in_tokens, out_tokens, cost_usd, state }) => ({ job_name, requests, answered: keys_answered?.length ?? 0, in_tokens, out_tokens, cost_usd, state })),
    total_usd: +rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(6), kraken_cpu_seconds: +outs.reduce((s, x) => s + (x.seconds || 0), 0).toFixed(1) });
  writeJson(`${RES}/results.json`, { issue: 5870, run_id: RUN.run_id, scored_at: new Date().toISOString(), measure: 'judged against a human reference: two blind Opus judges score the Lite (prompt v13) English made from each engine\'s read, fidelity 1–5, source = the by-eye corrected transcription; not accuracy', protocol: RUN.translation, models: { kraken: 'kraken 7.1 (greek-cllg | openiti persian_best | openiti arabic_best)', flash: 'gemini-3-flash-preview (A5 reocr)' }, baseline: 'flash', candidate: 'kraken',
    gate: H.gate, agreement: H.agreement, families, pages });
  console.log(`wrote ${RES}/results.json (${pages.length} pages)`);
}

// ── lift, per dollar, wall clock, the repriced A5 plan ────────────────────────────────────────────────────────
// Prices per page, Batch: Flash re-OCR $0.00283 and Lite retranslation $0.00102 are A5's (sizing.md); the Kraken
// arm's translation is this run's measured spend / pages. Kraken's marginal cost is $0 (Hetzner CPU, already paid).
async function lift() {
  const { makeRng } = await import('../lib/paired-stats.mjs'); const { bootstrapItems } = await import('../lib/agreement-stats.mjs');
  const R = readJson(`${RES}/results.json`); const spend = readJson(`${RES}/spend.json`);
  const PRICE = { flash_reocr: 0.00283, lite_translate: 0.00102, kraken_translate: +(spend.total_usd / R.pages.length).toFixed(5) };
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
  const ci = (d) => (d.length < 2 ? [null, null] : bootstrapItems(d, (s) => s.reduce((a, x) => a + x, 0) / s.length, makeRng(5870), 4000).map(r2));
  const cut = (P) => { const m = (k) => r2(P.reduce((a, p) => a + p.fidelity[k], 0) / P.length); const d = (a, b) => P.map((p) => p.fidelity[a] - p.fidelity[b]);
    return { n: P.length, served: m('served'), flash: m('flash'), kraken: m('kraken'), lift_flash: r2(d('flash', 'served').reduce((a, x) => a + x, 0) / P.length), lift_flash_ci: ci(d('flash', 'served')),
      lift_kraken: r2(d('kraken', 'served').reduce((a, x) => a + x, 0) / P.length), lift_kraken_ci: ci(d('kraken', 'served')), kraken_minus_flash: r2(d('kraken', 'flash').reduce((a, x) => a + x, 0) / P.length), kraken_minus_flash_ci: ci(d('kraken', 'flash')) }; };
  const cuts = {};
  for (const [name, f] of [['Greek print ≤1699', (p) => p.script === 'Greek'], ['Persian print', (p) => p.script === 'Persian'], ['Arabic print', (p) => p.script === 'Arabic'], ['Arabic-script print', (p) => p.script !== 'Greek']])
    for (const [se, g] of [['all', () => true], ['served lite', (p) => p.served_engine === 'lite'], ['served flash', (p) => p.served_engine === 'flash']]) { const P = R.pages.filter((p) => f(p) && g(p)); if (P.length) cuts[`${name} | ${se}`] = cut(P); }
  const secs = (f) => { const s = R.pages.filter(f).map((p) => p.arms.kraken.seconds).sort((a, b) => a - b); return { n: s.length, mean: r2(s.reduce((a, x) => a + x, 0) / s.length), median: s[Math.floor(s.length / 2)], hours_per_10k_one_process: Math.round(s.reduce((a, x) => a + x, 0) / s.length * 1e4 / 3600) }; };
  const wall = { greek_cllg: secs((p) => p.script === 'Greek'), openiti: secs((p) => p.script !== 'Greek'), conditions: `two Kraken processes side by side (one Greek, one Arabic-script), nice 19, box load average 8–13 over ${os.cpus().length} cores shared with every worker` };
  const perPage = { flash: PRICE.flash_reocr + PRICE.lite_translate, kraken: PRICE.kraken_translate };
  const ppk = (l, usd) => (l == null ? null : Math.round(l / usd)); // page-points per $1K, in thousands (= lift ÷ $ per page)
  const perDollar = Object.fromEntries(Object.entries(cuts).filter(([k]) => / \| all$/.test(k)).map(([k, c]) => [k.replace(/ \| all$/, ''), { flash_usd_per_1k_pages: r2(perPage.flash * 1000), kraken_usd_per_1k_pages: r2(perPage.kraken * 1000), lift_flash: c.lift_flash, lift_kraken: c.lift_kraken, page_points_per_1k_usd_flash_thousands: ppk(c.lift_flash, perPage.flash), page_points_per_1k_usd_kraken_thousands: ppk(c.lift_kraken, perPage.kraken) }]));
  const PLAN = { Greek: 123511, Persian: 6222, Sanskrit: 49278, Pali: 7479 };
  const plan = Object.fromEntries(Object.entries(PLAN).map(([s, n]) => [s, { lite_read_pages: n, winner: 'flash re-read', flash_reocr_plus_lite_usd: Math.round(n * perPage.flash), if_kraken_usd: s === 'Greek' || s === 'Persian' ? Math.round(n * perPage.kraken) : null,
    if_kraken_cpu_days_one_process: s === 'Greek' ? Math.round(n * wall.greek_cllg.mean / 86400) : s === 'Persian' ? Math.round(n * wall.openiti.mean / 86400) : null }]));
  writeJson(`${RES}/lift.json`, { generated: new Date().toISOString(), prices_per_page: PRICE, cuts, per_dollar: perDollar, wall_clock: wall, plan,
    plan_total_usd: Object.values(plan).reduce((a, x) => a + x.flash_reocr_plus_lite_usd, 0) });
  console.log(JSON.stringify({ cuts, perDollar, wall, plan }, null, 1));
}

const STAGES = { seal, kraken, submit, collect, records, results, lift };
if (!STAGES[STAGE]) { console.error(`usage: contest.mjs ${Object.keys(STAGES).join(' | ')}`); process.exit(2); }
await STAGES[STAGE]();
