#!/usr/bin/env node
// PRIOR ART: scripts/eval/two-read-garble-5313.mjs (pilot-* stages) re-reads library pages on the production OCR
// request, but through its own Batch upload with no envelope and no translation step; scripts/eval/
// translation-vs-reference/t2/gemini-arms.mjs translates harness records on prompt v13 (and takes a source
// override), but logs each call under the real book id, which would let an envelope open that book to the
// pipeline's workers. scripts/batch/bulk-reocr-local.mjs is the production re-OCR and WRITES pages. This is the one
// chain #5700 A5 needs — re-read the image with a real engine, translate that read, never write a page — metered
// under a pseudo book id so the envelope opens nothing.
/** #5700 A5 paid pilot: re-OCR the #5695 track pages with a real engine, translate the new read on Lite and Flash, write nothing to pages/books. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/reocr-lift-5700/pilot.mjs <stage> [--work <dir>] [--cap-usd 8]
 *
 *   enrich     Mongo, READ-ONLY: image URL, book context, and which model/prompt made the served OCR   → <work>/enriched.jsonl
 *   ocr        paid: one fresh read per page (arm `reocr`), and a second on 30 seeded pages (`reocr2`) → <work>/ocr/<arm>/<id>.json
 *   translate  paid: prompt v13, one page per request, Lite and Flash, on four sources per page:
 *              the served OCR, the fresh read, the second fresh read (30 pages), the corrected text    → <work>/tr/<arm>/<id>.json
 *   collect    copy the outputs into the results directory as two JSONL files (no reference text)
 *
 * Request shapes. OCR = the production cross-book request (live default OCR prompt + document context, image
 * from getPageSource resized to 1500 px, temperature 0.1, 16,384 output tokens, thinking off), engine
 * gemini-3-flash-preview for every page (DECISIONS.md "OCR engine per stratum": Greek flash, the non-Latin
 * carve-out, Latin early print directional; no Tibetan or Syriac page is in the set). Translation = t2/gemini-arms'
 * shape (buildTranslationPrompt, no neighbour context, thinking off, temperature 0, BLOCK_NONE): at temperature 0
 * Lite repeated byte-identically on 75/75 pages in T2, so a difference between two arms is the SOURCE TEXT.
 * Realtime, not Batch: this job has no way to be woken when a Batch job lands. Prices are reported at the
 * Batch rate (× 0.5), spend at what was paid.
 *
 * Metering: every call goes through gemini-script-client with bookId `reocr-lift-5700` (a pseudo id no book
 * has), so `allow_scopes.reocr-lift-5700` measures it and opens no real book. The stage refuses to start without
 * that envelope and stops when measured + this run's spend reaches min(--cap-usd, envelope).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { buildTranslationPrompt, loadTranslationPrompts, sanitizeTranslationTags, SAFETY_SETTINGS, MODEL_FLASH, MODEL_LITE } from '../../lib/translate-core.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { getScopeSpendUsd } from '../../lib/spend-guard.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { getProductionOcrPrompt } from '../lib/production-prompt.mjs';
import { fetchImageBase64, docContext, OCR_GENERATION_CONFIG, SAFETY as OCR_SAFETY } from '../ocr-v18-ab.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const argv = process.argv.slice(2); const STAGE = argv[0];
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/reocr-lift-5700-work');
const RESULTS = opt('results', 'scripts/eval/results/reocr-lift-2026-10');
const CAP = Number(opt('cap-usd', 8)); const CONC = Number(opt('concurrency', 4));
const SCOPE = 'reocr-lift-5700'; const PSEUDO_BOOK = 'reocr-lift-5700'; const ENDPOINT = 'scripts/eval/reocr-lift-5700/pilot.mjs';
const OCR_MODEL = MODEL_FLASH; const AA_PAGES = 30; const SEED = 5700;
const rl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex').slice(0, 16);
const F = (...p) => path.join(WORK, ...p);
const trackPages = () => rl(path.join(RESULTS, 'track-pages.jsonl'));

const client = new MongoClient(process.env.MONGODB_URI);
let db; const mongo = async () => { if (!db) { await client.connect(); db = client.db('bookstore'); } return db; };

/** Envelope gate: measured spend on the pseudo book since the envelope was created. Fails closed. */
async function envelope() {
  const d = await mongo();
  const control = await d.collection('system_config').findOne({ _id: 'processing_control' });
  const env = control?.allow_scopes?.[SCOPE];
  if (!env?.budget_usd) { console.error(`no ${SCOPE} envelope — create it with set-scope.mjs first`); process.exit(2); }
  const m = await getScopeSpendUsd(d, { ids: [PSEUDO_BOOK], since: new Date(env.created_at) });
  if (m.meterError) { console.error(`envelope meter unreadable (${m.meterError}) — refusing`); process.exit(2); }
  return { budget: Math.min(CAP, env.budget_usd), measured: m.usd, rows: m.rows };
}
async function pool(items, fn) { const q = [...items]; await Promise.all(Array.from({ length: CONC }, async () => { while (q.length) await fn(q.shift()); })); }
async function withRetry(fn) {
  for (let a = 1; ; a++) {
    try { return await fn(); } catch (e) { if (a >= 4 || !/Gemini (503|429|500)|timeout|aborted|fetch failed/i.test(String(e.message))) throw e; await new Promise((ok) => setTimeout(ok, 6000 * a)); }
  }
}

async function stageEnrich() {
  const d = await mongo(); fs.mkdirSync(WORK, { recursive: true }); const out = [];
  for (const r of trackPages()) {
    const b = await d.collection('books').findOne({ id: r.book_id }, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, original_language: 1, languages: 1, image_source: 1, content_type: 1, visible: 1 } });
    const p = await d.collection('pages').findOne({ book_id: r.book_id, page_number: r.page_number }, { projection: { id: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.prompt_version': 1, 'ocr.updated_at': 1, 'ocr.source': 1, 'translation.model': 1, 'translation.prompt_version': 1 } });
    if (!b || !p) { out.push({ id: r.id, error: !b ? 'book-not-found' : 'page-not-found' }); continue; }
    const langs = [b.language, b.original_language, ...(Array.isArray(b.languages) ? b.languages : [])].filter((x) => typeof x === 'string');
    out.push({ id: r.id, track: r.track, book_id: r.book_id, page_number: r.page_number, page_id: p.id, image: getPageSource(p),
      book: { title: b.title, author: b.author, year: b.year ?? null, published: b.published ?? null, language: b.language, content_type: b.content_type ?? null, image_source: b.image_source?.provider ?? null },
      tibetan_or_syriac: langs.some((x) => /tibet|syriac|^bo$|^bod$|^syr$|^syc$/i.test(x.trim())),
      served_ocr: { model: p.ocr?.model ?? null, prompt_version: p.ocr?.prompt_version ?? null, source: p.ocr?.source ?? null, updated_at: p.ocr?.updated_at ?? null, sha_now: sha(p.ocr?.data), sha_track: sha(r.ocr_text), unchanged_since_track: sha(p.ocr?.data) === sha(r.ocr_text) },
      served_translation: { model: p.translation?.model ?? null, prompt_version: p.translation?.prompt_version ?? null } });
  }
  fs.writeFileSync(F('enriched.jsonl'), out.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const ok = out.filter((x) => !x.error); const by = {}; for (const x of ok) { const k = x.served_ocr.model || 'none'; by[k] = (by[k] || 0) + 1; }
  console.log(`enriched ${ok.length}/${out.length}; no image ${ok.filter((x) => !x.image).length}; tibetan/syriac ${ok.filter((x) => x.tibetan_or_syriac).length}; served OCR changed since the track ran ${ok.filter((x) => !x.served_ocr.unchanged_since_track).length}`);
  console.log('served OCR model:', by);
}

/** The 30 A-vs-A pages: a seeded draw over the pages that have a corrected transcription. */
function aaIds() {
  const ids = trackPages().filter((r) => r.has_corrected).map((r) => r.id).sort(); const rng = makeRng(SEED);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return new Set(ids.slice(0, AA_PAGES));
}

/**
 * Leaf check: re-read from `display_photo` (the image the reader is shown and the #5695 correctors opened) the pages
 * listed in <work>/display-ids.json. Where the pipeline's OCR source (getPageSource → archived_photo) is a different
 * leaf from the displayed one (#3368), the `reocr` arm read the wrong leaf and this arm is the fair one.
 */
async function stageOcrDisplay() {
  const d = await mongo(); const env = await envelope(); const prompt = await getProductionOcrPrompt(d);
  const ids = new Set(JSON.parse(fs.readFileSync(F('display-ids.json'), 'utf8'))); const pages = rl(F('enriched.jsonl')).filter((x) => ids.has(x.id));
  let spent = 0;
  await pool(pages, async (p) => {
    const f = F('ocr', 'reocr-display', `${p.id}.json`); if (fs.existsSync(f)) return;
    if (env.measured + spent >= env.budget) return;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const pg = await d.collection('pages').findOne({ id: p.page_id }, { projection: { display_photo: 1 } });
    if (!pg?.display_photo || pg.display_photo === p.image) { fs.writeFileSync(f.replace(/\.json$/, '.skipped.json'), JSON.stringify({ id: p.id, arm: 'reocr-display', error: pg?.display_photo ? 'display_photo is the OCR source' : 'no display_photo' })); return; }
    try {
      const img = await withRetry(() => fetchImageBase64(pg.display_photo));
      const text = `${prompt.text}${docContext({ title: p.book.title, author: p.book.author, year: p.book.year })}`;
      const res = await withRetry(() => callGemini({ model: OCR_MODEL, prompt: text, imageParts: [{ mimeType: img.mimeType, data: img.data }], endpoint: ENDPOINT, type: 'eval', bookId: PSEUDO_BOOK, pageIds: [p.id],
        thinkingBudget: 0, temperature: OCR_GENERATION_CONFIG.temperature, maxOutputTokens: OCR_GENERATION_CONFIG.maxOutputTokens, safetySettings: OCR_SAFETY, promptVersion: `ocr-v${prompt.version}`, triggeredBy: SCOPE }));
      const cost = costOf(OCR_MODEL, res.inputTokens, res.outputTokens); spent += cost;
      fs.writeFileSync(f, JSON.stringify({ id: p.id, arm: 'reocr-display', model: OCR_MODEL, text: res.text, finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, thinkingTokens: res.thinkingTokens,
        cost_usd_realtime: cost, prompt: { name: prompt.name, version: prompt.version }, generation: OCR_GENERATION_CONFIG, image: pg.display_photo, image_bytes_sent: img.bytes, at: new Date().toISOString() }, null, 1));
    } catch (e) { fs.writeFileSync(f.replace(/\.json$/, '.failed.json'), JSON.stringify({ id: p.id, arm: 'reocr-display', error: String(e.message).slice(0, 400) })); }
  });
  console.log(`ocr-display: ${pages.length} pages, $${spent.toFixed(4)} realtime this run`);
}

async function stageOcr() {
  const d = await mongo(); const env = await envelope(); const prompt = await getProductionOcrPrompt(d);
  const pages = rl(F('enriched.jsonl')).filter((x) => !x.error && x.image && !x.tibetan_or_syriac); const aa = aaIds();
  const jobs = [...pages.map((p) => ['reocr', p]), ...pages.filter((p) => aa.has(p.id)).map((p) => ['reocr2', p])];
  console.log(`ocr: ${jobs.length} requests (${pages.length} pages + ${jobs.length - pages.length} repeats) on ${OCR_MODEL}, prompt "${prompt.name}" v${prompt.version}; envelope $${env.measured.toFixed(4)} / $${env.budget}`);
  let spent = 0, done = 0, stop = false;
  await pool(jobs, async ([arm, p]) => {
    const f = F('ocr', arm, `${p.id}.json`); if (fs.existsSync(f) || stop) return;
    if (env.measured + spent >= env.budget) { stop = true; console.log(`STOP: envelope $${(env.measured + spent).toFixed(4)} ≥ $${env.budget}`); return; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try {
      const img = await withRetry(() => fetchImageBase64(p.image));
      const text = `${prompt.text}${docContext({ title: p.book.title, author: p.book.author, year: p.book.year })}`;
      const res = await withRetry(() => callGemini({ model: OCR_MODEL, prompt: text, imageParts: [{ mimeType: img.mimeType, data: img.data }], endpoint: ENDPOINT, type: 'eval', bookId: PSEUDO_BOOK, pageIds: [p.id],
        thinkingBudget: OCR_GENERATION_CONFIG.thinkingConfig.thinkingBudget, temperature: OCR_GENERATION_CONFIG.temperature, maxOutputTokens: OCR_GENERATION_CONFIG.maxOutputTokens, safetySettings: OCR_SAFETY, promptVersion: `ocr-v${prompt.version}`, triggeredBy: SCOPE }));
      const cost = costOf(OCR_MODEL, res.inputTokens, res.outputTokens); spent += cost; done++;
      fs.writeFileSync(f, JSON.stringify({ id: p.id, arm, model: OCR_MODEL, text: res.text, finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, thinkingTokens: res.thinkingTokens,
        cost_usd_realtime: cost, prompt: { name: prompt.name, version: prompt.version, content_hash: prompt.content_hash }, generation: OCR_GENERATION_CONFIG, image: p.image, image_bytes_sent: img.bytes, at: new Date().toISOString() }, null, 1));
    } catch (e) { fs.writeFileSync(f.replace(/\.json$/, '.failed.json'), JSON.stringify({ id: p.id, arm, error: String(e.message).slice(0, 400) })); console.log(`${arm} ${p.id} FAILED ${String(e.message).slice(0, 120)}`); }
  });
  console.log(`ocr: ${done} new reads, $${spent.toFixed(4)} realtime this run`);
}

const TR_MODELS = { lite: MODEL_LITE, flash: MODEL_FLASH };
/** Usable text of a fresh read, or null when the read is a refusal, empty, or cut off (never translated, never scored as text). */
function ocrOut(arm, id) { const f = F('ocr', arm, `${id}.json`); if (!fs.existsSync(f)) return null; const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j.finishReason === 'STOP' && j.text?.trim() ? j.text : null; }

async function stageTranslate() {
  const d = await mongo(); const env = await envelope(); const prompts = await loadTranslationPrompts(d);
  console.log(`translate: prompt ${prompts.translation.ref.name} v${prompts.translation.ref.version}; envelope $${env.measured.toFixed(4)} / $${env.budget}`);
  const enriched = Object.fromEntries(rl(F('enriched.jsonl')).map((x) => [x.id, x])); const jobs = [];
  for (const r of trackPages()) {
    if (!r.has_corrected) continue;   // fidelity to the page needs the corrected text as the judge's source; the 10 low pages without one are read (ocr stage) but not translated
    const sources = { ocr: r.ocr_text, reocr: ocrOut('reocr', r.id), reocr2: ocrOut('reocr2', r.id), corr: r.corrected_text };
    for (const [src, text] of Object.entries(sources)) if (text) for (const m of Object.keys(TR_MODELS)) jobs.push({ arm: `${m}-${src}`, model: TR_MODELS[m], r, text });
  }
  console.log(`translate: ${jobs.length} requests`);
  let spent = 0, done = 0, stop = false;
  await pool(jobs, async ({ arm, model, r, text }) => {
    const f = F('tr', arm, `${r.id}.json`); if (fs.existsSync(f) || stop) return;
    if (env.measured + spent >= env.budget) { stop = true; console.log(`STOP: envelope $${(env.measured + spent).toFixed(4)} ≥ $${env.budget}`); return; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const book = await d.collection('books').findOne({ id: r.book_id }, { projection: { title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, image_source: 1 } });
    const ocrText = text.trim(); const { prompt, promptRef } = buildTranslationPrompt({ prompts, book, ocrText, previousTranslation: null });
    try {
      const res = await withRetry(() => callGemini({ model, prompt, endpoint: ENDPOINT, type: 'eval', bookId: PSEUDO_BOOK, pageIds: [enriched[r.id]?.page_id || r.id], thinkingBudget: 0, temperature: 0,
        maxOutputTokens: Math.min(32768, Math.max(4096, ocrText.length + 1200)), safetySettings: SAFETY_SETTINGS, promptVersion: `v${promptRef.version}`, triggeredBy: SCOPE }));
      const cost = costOf(model, res.inputTokens, res.outputTokens); spent += cost; done++;
      fs.writeFileSync(f, JSON.stringify({ id: r.id, arm, model, text: sanitizeTranslationTags(res.text || ''), finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, thinkingTokens: res.thinkingTokens,
        cost_usd_realtime: cost, prompt_ref: promptRef, source_sha: sha(ocrText), src_chars: ocrText.length, temperature: 0, thinkingBudget: 0, at: new Date().toISOString() }, null, 1));
    } catch (e) { fs.writeFileSync(f.replace(/\.json$/, '.failed.json'), JSON.stringify({ id: r.id, arm, error: String(e.message).slice(0, 400) })); console.log(`${arm} ${r.id} FAILED ${String(e.message).slice(0, 120)}`); }
  });
  console.log(`translate: ${done} new, $${spent.toFixed(4)} realtime this run`);
}

function stageCollect() {
  const dump = (sub, name) => { const rows = []; const base = F(sub); if (!fs.existsSync(base)) return rows;
    for (const arm of fs.readdirSync(base).sort()) for (const fn of fs.readdirSync(path.join(base, arm)).sort()) { const j = JSON.parse(fs.readFileSync(path.join(base, arm, fn), 'utf8')); rows.push(fn.endsWith('.failed.json') ? { ...j, outcome: 'error' } : { ...j, outcome: j.finishReason === 'STOP' && j.text?.trim() ? 'text' : j.finishReason === 'MAX_TOKENS' ? 'truncated' : j.text?.trim() ? 'refusal' : 'empty' }); }
    fs.writeFileSync(path.join(RESULTS, name), rows.map((x) => JSON.stringify(x)).join('\n') + '\n'); return rows; };
  const o = dump('ocr', 'reocr.jsonl'), t = dump('tr', 'translations.jsonl');
  fs.copyFileSync(F('enriched.jsonl'), path.join(RESULTS, 'enriched.jsonl'));
  const sum = (rows) => { const by = {}; for (const x of rows) { const k = `${x.arm} ${x.model || ''}`; by[k] ??= { n: 0, usd_realtime: 0, in: 0, out: 0, outcomes: {} }; by[k].n++; by[k].usd_realtime += x.cost_usd_realtime || 0; by[k].in += x.inputTokens || 0; by[k].out += x.outputTokens || 0; by[k].outcomes[x.outcome] = (by[k].outcomes[x.outcome] || 0) + 1; } return by; };
  const spend = { ocr: sum(o), translate: sum(t) }; spend.total_usd_realtime = [...o, ...t].reduce((s, x) => s + (x.cost_usd_realtime || 0), 0);
  fs.writeFileSync(path.join(RESULTS, 'spend.json'), JSON.stringify(spend, null, 1)); console.log(JSON.stringify(spend, null, 1));
}

const STAGES = { enrich: stageEnrich, ocr: stageOcr, 'ocr-display': stageOcrDisplay, translate: stageTranslate, collect: stageCollect };
if (!STAGES[STAGE]) { console.error(`usage: pilot.mjs ${Object.keys(STAGES).join(' | ')}`); process.exit(2); }
try { await STAGES[STAGE](); } finally { await client.close().catch(() => {}); }
