#!/usr/bin/env node
// PRIOR ART: scripts/eval/reocr-lift-5700/pilot.mjs — the same chain (production OCR request through
// gemini-script-client under a pseudo book id, then the production translation prompt, write nothing to pages/books),
// copied and changed: OCR engine gemini-3.1-flash-lite instead of Flash, input = this job's draw.jsonl instead of the
// #5695 track pages, a hard $ cap over BOTH stages kept in a local ledger and checked against gemini_usage, and no
// allow_scopes envelope (this run writes nothing to system_config either; the cap is the job's $1.00).
/** #6553 untested-language cells: flash-lite OCR + flash-lite translation of one interior page per book, measurement only. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local run-lite.mjs <ocr|translate|meter> --work=DIR [--cap-usd=1.00] [--limit=N] [--cells=a,b]
 * OCR       = live default OCR prompt + docContext, image via getPageSource → fetchImageBase64 (1500 px), temp 0.1,
 *             16,384 out, thinking 0, BLOCK_NONE (ocr-v18-ab.mjs OCR_GENERATION_CONFIG — the pilot's request).
 * Translate = buildTranslationPrompt (live prompt, no neighbour context), temp 0, thinking 0, on the fresh lite read.
 * Every call: bookId `cells-6553` (pseudo), endpoint this file, type 'eval'.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
const R = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { callGemini } = await import(`${R}/lib/gemini-script-client.mjs`);
const { buildTranslationPrompt, loadTranslationPrompts, sanitizeTranslationTags, SAFETY_SETTINGS, MODEL_LITE } = await import(`${R}/lib/translate-core.mjs`);
const { costOf } = await import(`${R}/lib/model-pricing.mjs`);
const { getScopeSpendUsd } = await import(`${R}/lib/spend-guard.mjs`);
const { getPageSource } = await import(`${R}/lib/page-image-url.mjs`);
const { getProductionOcrPrompt } = await import(`${R}/eval/lib/production-prompt.mjs`);
const { fetchImageBase64, docContext, OCR_GENERATION_CONFIG, SAFETY: OCR_SAFETY } = await import(`${R}/eval/ocr-v18-ab.mjs`);

const STAGE = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const WORK = arg('work'); const CAP = Number(arg('cap-usd', 1.0)); const LIMIT = Number(arg('limit', 1e9)); const CONC = Number(arg('concurrency', 4));
const CELLS = arg('cells') ? new Set(arg('cells').split(',')) : null;
const PSEUDO = 'cells-6553'; const ENDPOINT = 'scripts/eval/cells-6553/run-lite.mjs'; const MODEL = MODEL_LITE;
const F = (...p) => path.join(WORK, ...p);
const rl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const LEDGER = F('ledger.json');
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { started: new Date().toISOString(), usd: 0, calls: 0 };
const book = (fn) => { ledger.usd += fn; ledger.calls++; fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1)); };
const client = new MongoClient(process.env.MONGODB_URI); await client.connect(); const db = client.db('bookstore');
async function pool(items, fn) { const q = [...items]; await Promise.all(Array.from({ length: CONC }, async () => { while (q.length) await fn(q.shift()); })); }
async function withRetry(fn) { for (let a = 1; ; a++) { try { return await fn(); } catch (e) { if (a >= 4 || !/Gemini (503|429|500)|timeout|aborted|fetch failed/i.test(String(e.message))) throw e; await new Promise((ok) => setTimeout(ok, 6000 * a)); } } }
const draw = () => rl(F('draw.jsonl')).filter((x) => !CELLS || CELLS.has(x.cell)).slice(0, LIMIT);
let stop = false;
const room = (est) => { if (ledger.usd + est > CAP) { if (!stop) console.log(`STOP: ledger $${ledger.usd.toFixed(4)} + next ≈$${est.toFixed(4)} > cap $${CAP}`); stop = true; return false; } return true; };

async function ocr() {
  const prompt = await getProductionOcrPrompt(db); const items = draw();
  console.log(`ocr: ${items.length} pages on ${MODEL}, prompt "${prompt.name}" v${prompt.version}; ledger $${ledger.usd.toFixed(4)} / cap $${CAP}`);
  let done = 0;
  await pool(items, async (p) => {
    const f = F('ocr', `${p.page_id}.json`); if (fs.existsSync(f) || stop || !room(0.004)) return;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try {
      const pg = await db.collection('pages').findOne({ id: p.page_id }, { projection: { id: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 } });
      const image = getPageSource(pg); if (!image) throw new Error('no image source');
      const img = await withRetry(() => fetchImageBase64(image));
      fs.mkdirSync(F('images'), { recursive: true }); fs.writeFileSync(F('images', `${p.page_id}.${img.mimeType === 'image/png' ? 'png' : 'jpg'}`), Buffer.from(img.data, 'base64'));
      const text = `${prompt.text}${docContext({ title: p.title, author: p.author, year: p.year })}`;
      const res = await withRetry(() => callGemini({ model: MODEL, prompt: text, imageParts: [{ mimeType: img.mimeType, data: img.data }], endpoint: ENDPOINT, type: 'eval', bookId: PSEUDO, pageIds: [p.page_id],
        thinkingBudget: OCR_GENERATION_CONFIG.thinkingConfig.thinkingBudget, temperature: OCR_GENERATION_CONFIG.temperature, maxOutputTokens: OCR_GENERATION_CONFIG.maxOutputTokens, safetySettings: OCR_SAFETY, promptVersion: `ocr-v${prompt.version}`, triggeredBy: PSEUDO }));
      const cost = costOf(MODEL, res.inputTokens, res.outputTokens); book(cost); done++;
      fs.writeFileSync(f, JSON.stringify({ page_id: p.page_id, cell: p.cell, model: MODEL, text: res.text, finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, cost_usd: cost,
        prompt: { name: prompt.name, version: prompt.version }, image, image_bytes_sent: img.bytes, at: new Date().toISOString() }, null, 1));
    } catch (e) { fs.writeFileSync(f.replace(/\.json$/, '.failed.json'), JSON.stringify({ page_id: p.page_id, cell: p.cell, error: String(e.message).slice(0, 400) })); console.log(`${p.page_id} FAILED ${String(e.message).slice(0, 120)}`); }
  });
  console.log(`ocr: ${done} new reads; ledger $${ledger.usd.toFixed(4)} over ${ledger.calls} calls`);
}

const usable = (id) => { const f = F('ocr', `${id}.json`); if (!fs.existsSync(f)) return null; const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j.finishReason === 'STOP' && j.text?.replace(/<[^>]+>/g, '').trim().length >= 40 ? j.text : null; };
async function translate() {
  const prompts = await loadTranslationPrompts(db); const items = draw().filter((p) => usable(p.page_id));
  // Russian/Portuguese first (the plan's translation cells), then the zero cells, then the OCR-only cells last.
  // Zero cells round-robin (k-th page of every cell before the (k+1)-th), so a cap that bites thins every cell evenly.
  const k = {}; for (const p of items) p._k = (k[p.cell] = (k[p.cell] ?? -1) + 1);
  const rank = (p) => (p.task === 'tr' ? 0 : p.task === 'zero' ? 1 + p._k : 1000); items.sort((a, b) => rank(a) - rank(b));
  console.log(`translate: ${items.length} pages with a usable read; prompt ${prompts.translation.ref.name} v${prompts.translation.ref.version}; ledger $${ledger.usd.toFixed(4)} / cap $${CAP}`);
  let done = 0;
  await pool(items, async (p) => {
    const f = F('tr', `${p.page_id}.json`); if (fs.existsSync(f) || stop) return;
    const ocrText = usable(p.page_id).trim(); if (!room(0.0025 + ocrText.length * 1.5e-6)) return;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const b = await db.collection('books').findOne({ id: p.book_id }, { projection: { title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, image_source: 1 } });
    const { prompt, promptRef } = buildTranslationPrompt({ prompts, book: b, ocrText, previousTranslation: null });
    try {
      const res = await withRetry(() => callGemini({ model: MODEL, prompt, endpoint: ENDPOINT, type: 'eval', bookId: PSEUDO, pageIds: [p.page_id], thinkingBudget: 0, temperature: 0,
        maxOutputTokens: Math.min(32768, Math.max(4096, ocrText.length + 1200)), safetySettings: SAFETY_SETTINGS, promptVersion: `v${promptRef.version}`, triggeredBy: PSEUDO }));
      const cost = costOf(MODEL, res.inputTokens, res.outputTokens); book(cost); done++;
      fs.writeFileSync(f, JSON.stringify({ page_id: p.page_id, cell: p.cell, model: MODEL, text: sanitizeTranslationTags(res.text || ''), finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, cost_usd: cost, prompt_ref: promptRef, at: new Date().toISOString() }, null, 1));
    } catch (e) { fs.writeFileSync(f.replace(/\.json$/, '.failed.json'), JSON.stringify({ page_id: p.page_id, cell: p.cell, error: String(e.message).slice(0, 400) })); console.log(`${p.page_id} FAILED ${String(e.message).slice(0, 120)}`); }
  });
  console.log(`translate: ${done} new; ledger $${ledger.usd.toFixed(4)} over ${ledger.calls} calls`);
}

async function meter() {
  const m = await getScopeSpendUsd(db, { ids: [PSEUDO], since: new Date(ledger.started) });
  const byModel = await db.collection('gemini_usage').aggregate([{ $match: { book_id: PSEUDO } }, { $group: { _id: { model: '$model', endpoint: '$endpoint' }, usd: { $sum: '$cost_usd' }, rows: { $sum: 1 } } }]).toArray();
  const out = { measured: m, mongo_by_model: byModel, ledger, at: new Date().toISOString() };
  fs.writeFileSync(F('meter.json'), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
}

const S = { ocr, translate, meter };
if (!S[STAGE]) { console.error('usage: run-lite.mjs ocr|translate|meter --work=DIR'); process.exit(2); }
try { await S[STAGE](); } finally { await client.close().catch(() => {}); }
