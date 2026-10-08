#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t1 — reused. arms.mjs there replays translate-worker's translatePage (buildTranslationPrompt + PAGE_BREAK_SCOPED, previous page's served translation, BLOCK_NONE, thinking 0) with temperature fixed at 1 and one lever per arm; tengyur-levers/run-arms.mjs does the same for the Tengyur's one-page, no-context request. Neither has temperature as an arm or runs both models over three sets, so this keeps their request and changes only `temperature`.
/** Temperature arms for #6202: the production translation request at temperature 1, 0.2 and 0, on Lite and Flash, over the 150 referenced pages. Files only; metered as temp-6202. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/temp-6202/run-arms.mjs \
 *        [--work /data/scratch/sl/temp-6202] [--models lite,flash] [--arms T1a,T1b,T1c,T02a,T02b,T0a,T0b] [--sets tengyur,t4,latin] [--cap-usd 9.5] [--conc 6] [--dry-run]
 * Output <work>/arms/<model>-<arm>/<book>_<page>.json. Resumable. Every call is logged to <work>/ledger.jsonl and to
 * gemini_usage (book_id 'temp-6202', triggered_by 'temp-6202:<model>-<arm>'); the run refuses to pass --cap-usd.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { buildTranslationPrompt, loadTranslationPrompts, getTranslateModelForBook, SAFETY_SETTINGS, PAGE_BREAK_SCOPED, MODEL_FLASH, MODEL_LITE, sanitizeTranslationTags } from '../../lib/translate-core.mjs';
import { maxOutputTokensFor } from '../../lib/translate-batch-seam.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { readJsonl, sha16 } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/temp-6202');
const MODELS = opt('models', 'lite,flash').split(',');
const ARMS = opt('arms', 'T1a,T1b,T1c,T02a,T02b,T0a,T0b').split(',');
const SETS = new Set(opt('sets', 'tengyur,t4,latin').split(','));
const CAP = Number(opt('cap-usd', 9.5));
const CONC = Number(opt('conc', 6));
const DRY = args.includes('--dry-run');
export const ENVELOPE = 'temp-6202';
export const PROMPT_VERSION = 13;
export const PROMPT_HASH = '516510147237b6a79d9d3f6e797bba7f'; // v13 "Standard Translation", as pinned in tengyur-ref-2026-10/arms/run.json
const MODEL = { lite: MODEL_LITE, flash: MODEL_FLASH };
export const TEMP = { T1a: 1, T1b: 1, T1c: 1, T02a: 0.2, T02b: 0.2, T0a: 0, T0b: 0 };
for (const a of ARMS) if (!(a in TEMP)) { console.error(`unknown arm ${a}`); process.exit(1); }
for (const m of MODELS) if (!MODEL[m]) { console.error(`unknown model ${m}`); process.exit(1); }

const LEDGER = path.join(WORK, 'ledger.jsonl');
let spent = fs.existsSync(LEDGER) ? readJsonl(LEDGER).reduce((s, r) => s + r.usd, 0) : 0;
let est = 0;

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const prompts = await loadTranslationPrompts(db);
const recs = readJsonl(path.join(WORK, 'records.jsonl')).filter((r) => SETS.has(r.set));

const ctxCache = new Map();
async function requestFor(r) {
  const k = `${r.book_id}_${r.page_number}`;
  if (ctxCache.has(k)) return ctxCache.get(k);
  const f = path.join(WORK, 'requests', `${k}.json`);
  if (fs.existsSync(f)) { const v = JSON.parse(fs.readFileSync(f, 'utf8')); ctxCache.set(k, v); return v; }
  const worker = r.context_mode === 'worker';
  const [book, prev, next] = await Promise.all([
    db.collection('books').findOne({ id: r.book_id }, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, image_source: 1, catalog_ids: 1 } }),
    worker ? db.collection('pages').findOne({ book_id: r.book_id, page_number: r.page_number - 1 }, { projection: { 'ocr.data': 1, 'translation.data': 1 } }) : null,
    worker ? db.collection('pages').findOne({ book_id: r.book_id, page_number: r.page_number + 1 }, { projection: { 'ocr.data': 1 } }) : null,
  ]);
  if (!book) throw new Error(`book ${r.book_id} not found`);
  // 'worker' = translate-worker translatePage; 'none' = the Tengyur draft's one-page request (translate-batch-chained, context.mode none)
  const { prompt, promptRef, pageBreak } = buildTranslationPrompt({ prompts, book, ocrText: r.source_text,
    ...(worker ? { previousTranslation: prev?.translation?.data || null, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined } : {}), pageBreak: PAGE_BREAK_SCOPED });
  if (Number(promptRef.version) !== PROMPT_VERSION || promptRef.content_hash !== PROMPT_HASH) throw new Error(`prompt is not v${PROMPT_VERSION}/${PROMPT_HASH}: got v${promptRef.version}/${promptRef.content_hash}`);
  // The request is frozen on first build so every arm of a page sends the SAME bytes even if a neighbour page is re-translated mid-run.
  const v = { id: k, prompt, prompt_sha16: sha16(prompt), prompt_ref: promptRef, production_model: getTranslateModelForBook(book), maxOutputTokens: maxOutputTokensFor([{ ocr: { data: r.source_text } }]),
    context: { mode: r.context_mode, previous_translation: worker && !!prev?.translation?.data, prev_ocr: worker && !!prev?.ocr?.data, next_ocr: worker && !!next?.ocr?.data, page_break: pageBreak } };
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v));
  ctxCache.set(k, v); return v;
}

async function runOne(m, arm, r) {
  const id = `${r.book_id}_${r.page_number}`; const dir = path.join(WORK, 'arms', `${m}-${arm}`); const outf = path.join(dir, `${id}.json`);
  if (fs.existsSync(outf)) return;
  const q = await requestFor(r); const model = MODEL[m]; const temperature = TEMP[arm];
  const guess = costOf(model, q.prompt.length / 3, r.source_text.length / 3 + 400);
  if (DRY) { est += guess; return; }
  if (spent + guess > CAP) throw new Error(`CAP: spent $${spent.toFixed(3)} + next $${guess.toFixed(4)} > $${CAP}`);
  let res; let attempts = 0; let lastErr = null; const t0 = Date.now();
  // Registered resend rule: transient errors retry up to 4 times; an EMPTY answer (RECITATION, SAFETY, blank) is resent ONCE at the same settings.
  for (let empties = 0; attempts < 5;) {
    attempts++;
    try {
      res = await callGemini({ model, prompt: q.prompt, endpoint: 'scripts/eval/temp-6202/run-arms.mjs', thinkingBudget: 0, temperature, maxOutputTokens: q.maxOutputTokens, safetySettings: SAFETY_SETTINGS, type: 'eval', bookId: ENVELOPE, pageIds: [id], promptVersion: `v${PROMPT_VERSION}`, triggeredBy: `${ENVELOPE}:${m}-${arm}` });
      const usd = costOf(model, res.inputTokens, res.outputTokens); spent += usd;
      fs.appendFileSync(LEDGER, JSON.stringify({ kind: 'arm', model: m, arm, id, in: res.inputTokens, out: res.outputTokens, thinking: res.thinkingTokens || 0, usd, finish: res.finishReason, at: new Date().toISOString() }) + '\n');
      if (res.text && res.text.trim()) break;
      lastErr = `empty (${res.finishReason})`; res = null; if (++empties >= 2) break;
    } catch (err) {
      lastErr = String(err.message).slice(0, 200);
      if (!/(503|429|500|overloaded|UNAVAILABLE|timeout|aborted|fetch failed)/i.test(lastErr)) break;
      await new Promise((ok) => setTimeout(ok, 4000 * attempts));
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  if (!res) { fs.writeFileSync(outf.replace(/\.json$/, '.failed.json'), JSON.stringify({ id, model: m, arm, error: lastErr, attempts })); console.log(`${m}-${arm} ${id} FAILED: ${lastErr}`); return; }
  fs.writeFileSync(outf, JSON.stringify({ id, set: r.set, model_key: m, arm, model, text: sanitizeTranslationTags(res.text), finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, thinkingTokens: res.thinkingTokens || 0,
    cost_usd: costOf(model, res.inputTokens, res.outputTokens), ms: Date.now() - t0, attempts, generationConfig: { temperature, maxOutputTokens: q.maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } }, prompt_ref: q.prompt_ref, prompt_sha16: q.prompt_sha16, production_model: q.production_model, context: q.context, ocr_chars: r.source_text.length }));
}

try {
  for (const m of MODELS) for (const arm of ARMS) {
    const queue = [...recs]; let cap = null;
    await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length && !cap) { try { await runOne(m, arm, queue.shift()); } catch (e) { if (String(e.message).startsWith('CAP')) cap = e; else throw e; } } }));
    if (cap) throw cap;
    const dir = path.join(WORK, 'arms', `${m}-${arm}`); const fl = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    console.log(`${m}-${arm}: ${fl.filter((f) => !f.endsWith('.failed.json')).length} done, ${fl.filter((f) => f.endsWith('.failed.json')).length} failed; ${DRY ? `estimate $${est.toFixed(3)}` : `ledger $${spent.toFixed(3)}`}`);
  }
} finally { await c.close(); }
console.log(DRY ? `ESTIMATED $${est.toFixed(3)} for ${MODELS.join(',')} × ${ARMS.join(',')} on ${recs.length} pages` : `ledger total $${spent.toFixed(4)} (cap $${CAP})`);
