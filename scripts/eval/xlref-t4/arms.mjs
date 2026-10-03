#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t1/arms.mjs (#5695 T1, unmerged sibling branch) — this is that runner, copied so the
// five tracks run ONE production-shaped call (buildTranslationPrompt with PAGE_BREAK_SCOPED, previous page's served
// translation as continuity, BLOCK_NONE, thinking 0, default temperature); only the envelope, the glossary wording
// and a --fixed-suffix differ. scripts/eval/tibetan-mt-ab/gemini-arms.mjs has no continuity context and temperature 0.
/** Lever arms for #5695 T4: production-shaped Gemini translations of the reference pages, one deviation per arm, metered on envelope xlref-t4. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/xlref-t4/arms.mjs \
 *        --input <records.jsonl> --out <dir> --arms lite-A,lite-B,flash-0 [--ids book_page,…] [--max-usd 8] [--dry-run]
 *
 * Arms (one deviation from production each; production = getTranslateModelForBook, i.e. lite except BPH):
 *   prod-A / prod-B   production twice (X1 noise floor)            lite-A / lite-B   lite twice
 *   flash-0           flash, thinking 0                            flash-think       flash, thinkingBudget 2048 (measured: no thinking happens)
 *   flash-think8k     flash, thinkingBudget 8192 (X2, the arm that actually reasons)
 *   lite-noctx        lite, no previous translation, no neighbour OCR
 *   lite-gloss        lite + an open-source glossary block (--glossary <file>)
 *   lite-fixocr       lite on a corrected transcription (--fixed-dir <dir> with <book>_<page>.txt; pages without one are skipped)
 *   flash-fixocr      flash on the corrected transcription
 * --dump-prompt-dir <dir>: write each page's exact prompt for the arm and call nothing (X3: Opus translates these).
 * Output <out>/<arm>/<book>_<page>.json {text, model, generationConfig, tokens, thinkingTokens, cost_usd, prompt_ref, context}.
 * Resumable. Usage rows go to gemini_usage with book_id 'xlref-t4' (the envelope's meter); the run refuses when the
 * envelope's measured spend plus this run's spend would pass --max-usd.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { buildTranslationPrompt, loadTranslationPrompts, getTranslateModelForBook, SAFETY_SETTINGS, PAGE_BREAK_SCOPED, MODEL_FLASH, MODEL_LITE, sanitizeTranslationTags } from '../../lib/translate-core.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { getScopeSpendUsd } from '../../lib/spend-guard.mjs';
import { readJsonl } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const INPUT = opt('input'); const OUT = opt('out');
const ARMS = opt('arms', 'prod-A').split(',');
const IDS = opt('ids') ? new Set(opt('ids').split(',')) : null;
const MAX_USD = Number(opt('max-usd', 8));
const DRY = args.includes('--dry-run');
const GLOSSARY = opt('glossary') ? fs.readFileSync(opt('glossary'), 'utf8').trim() : null;
const FIXED = opt('fixed-dir');
const ENVELOPE = 'xlref-t4';
const CONC = Number(opt('concurrency', 4));
const DUMP = opt('dump-prompt-dir'); // write the exact prompt per page instead of calling Gemini (the X3 Opus ceiling reads these)
if (!INPUT || !OUT) { console.error('--input and --out required'); process.exit(1); }

const SPEC = {
  'prod-A': { model: 'prod', ctx: true }, 'prod-B': { model: 'prod', ctx: true },
  'lite-A': { model: MODEL_LITE, ctx: true }, 'lite-B': { model: MODEL_LITE, ctx: true },
  'flash-0': { model: MODEL_FLASH, ctx: true },
  'flash-think': { model: MODEL_FLASH, ctx: true, thinkingBudget: 2048 },
  // probe 2026-10-03: on gemini-3-flash-preview a 2048 budget returns NO thoughtsTokenCount (the model does not think); 8192 does (3,651 tokens on one page). flash-think is therefore a second flash-0 replicate; flash-think8k is the real X2 arm.
  'flash-think8k': { model: MODEL_FLASH, ctx: true, thinkingBudget: 8192 },
  'lite-noctx': { model: MODEL_LITE, ctx: false },
  'lite-gloss': { model: MODEL_LITE, ctx: true, glossary: true },
  'lite-fixocr': { model: MODEL_LITE, ctx: true, fixed: true },
  'flash-fixocr': { model: MODEL_FLASH, ctx: true, fixed: true },
};
for (const a of ARMS) if (!SPEC[a]) { console.error(`unknown arm ${a}`); process.exit(1); }
const maxOutputTokensFor = (ocrChars) => Math.min(32768, Math.max(4096, Math.ceil(ocrChars) + 1200)); // translate-worker, one page

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const prompts = await loadTranslationPrompts(db);
const recs = readJsonl(INPUT).filter((r) => !IDS || IDS.has(`${r.book_id}_${r.page_number}`));
const ctl = await db.collection('system_config').findOne({ _id: 'processing_control' });
const env = ctl?.allow_scopes?.[ENVELOPE];
if (!env?.created_at) throw new Error(`envelope ${ENVELOPE} missing — refusing to spend`);
const metered = async () => { const s = await getScopeSpendUsd(db, { ids: [ENVELOPE], since: new Date(env.created_at) }); if (s.meterError) throw new Error(`envelope meter unreadable: ${s.meterError}`); return s.usd; };
let envUsd = DRY || DUMP ? 0 : await metered();
let runUsd = 0;
console.log(`envelope ${ENVELOPE}: measured $${envUsd.toFixed(3)} / cap $${MAX_USD} (budget $${env.budget_usd})`);

const ctxCache = new Map();
async function context(r) {
  const k = `${r.book_id}_${r.page_number}`;
  if (ctxCache.has(k)) return ctxCache.get(k);
  const [book, prev, next] = await Promise.all([
    db.collection('books').findOne({ id: r.book_id }, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, image_source: 1 } }),
    db.collection('pages').findOne({ book_id: r.book_id, page_number: r.page_number - 1 }, { projection: { 'ocr.data': 1, 'translation.data': 1 } }),
    db.collection('pages').findOne({ book_id: r.book_id, page_number: r.page_number + 1 }, { projection: { 'ocr.data': 1 } }),
  ]);
  const v = { book, prevTranslation: prev?.translation?.data || null, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined };
  ctxCache.set(k, v); return v;
}

async function runOne(arm, r) {
  const spec = SPEC[arm]; const id = `${r.book_id}_${r.page_number}`;
  const outf = path.join(OUT, arm, `${id}.json`);
  if (fs.existsSync(outf)) return;
  let ocrText = r.source_text;
  if (spec.fixed) { const f = path.join(FIXED || '', `${id}.txt`); if (!FIXED || !fs.existsSync(f)) return; ocrText = fs.readFileSync(f, 'utf8'); }
  const cx = await context(r);
  const model = spec.model === 'prod' ? getTranslateModelForBook(cx.book) : spec.model;
  let { prompt, promptRef, pageBreak } = buildTranslationPrompt({
    prompts, book: cx.book, ocrText,
    previousTranslation: spec.ctx ? cx.prevTranslation : null,
    prevOcrText: spec.ctx ? cx.prevOcrText : undefined, nextOcrText: spec.ctx ? cx.nextOcrText : undefined,
    pageBreak: spec.ctx ? PAGE_BREAK_SCOPED : undefined,
  });
  if (spec.glossary) {
    if (!GLOSSARY) throw new Error('lite-gloss needs --glossary');
    prompt = prompt.replace('\n\n**Text to translate:**', `\n\n**Glossary (from open sources; use these senses where the term occurs; keep the source term, transliterated, in a <term> tag on first use if the English is not obvious):**\n${GLOSSARY}\n\n**Text to translate:**`);
  }
  if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(path.join(DUMP, `${id}.txt`), prompt); return; }
  const maxOutputTokens = maxOutputTokensFor(ocrText.length) + (spec.thinkingBudget || 0); // thoughts count against the output cap
  const generationConfig = { temperature: 1, maxOutputTokens, thinkingConfig: { thinkingBudget: spec.thinkingBudget || 0 } };
  if (DRY) { const est = costOf(model, prompt.length / 3.5, ocrText.length / 3 + 400 + (spec.thinkingBudget || 0)); runUsd += est; return; }
  if (envUsd + runUsd > MAX_USD - 0.05) throw new Error(`spend cap: envelope $${envUsd.toFixed(3)} + run $${runUsd.toFixed(3)} ≥ $${MAX_USD}`);
  let res; const t0 = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      res = await callGemini({ model, prompt, endpoint: 'scripts/eval/xlref-t4/arms.mjs', thinkingBudget: spec.thinkingBudget || 0, temperature: 1, maxOutputTokens, safetySettings: SAFETY_SETTINGS, type: 'eval', bookId: ENVELOPE, pageIds: [id], promptVersion: `v${promptRef.version}`, triggeredBy: `xlref-t4:${arm}` });
      break;
    } catch (err) {
      if (attempt >= 4 || !/(503|429|500|overloaded|UNAVAILABLE)/i.test(String(err.message))) {
        fs.mkdirSync(path.join(OUT, arm), { recursive: true });
        fs.writeFileSync(outf.replace(/\.json$/, '.failed.json'), JSON.stringify({ id, arm, error: String(err.message).slice(0, 300), attempts: attempt }, null, 1));
        console.log(`${arm} ${id} FAILED: ${String(err.message).slice(0, 120)}`); return;
      }
      await new Promise((ok) => setTimeout(ok, 4000 * attempt));
    }
  }
  // outputTokens already carries thoughtsTokenCount (outputTokensFrom, #4581): thinking bills at the output rate
  const cost_usd = costOf(model, res.inputTokens, res.outputTokens);
  runUsd += cost_usd;
  fs.mkdirSync(path.join(OUT, arm), { recursive: true });
  fs.writeFileSync(outf, JSON.stringify({ id, arm, model, text: sanitizeTranslationTags(res.text), finishReason: res.finishReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, thinkingTokens: res.thinkingTokens || 0, cost_usd, ms: Date.now() - t0, generationConfig, prompt_ref: promptRef, context: { previous_translation: spec.ctx && !!cx.prevTranslation, prev_ocr: spec.ctx && !!cx.prevOcrText, next_ocr: spec.ctx && !!cx.nextOcrText, page_break: pageBreak, glossary: !!spec.glossary, fixed_ocr: !!spec.fixed }, ocr_chars: ocrText.length }, null, 1));
}

try {
  for (const arm of ARMS) {
    const queue = [...recs];
    await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await runOne(arm, queue.shift()); }));
    console.log(`${arm}: done; run spend so far $${runUsd.toFixed(4)}`);
  }
} finally {
  if (!DRY && !DUMP) { try { envUsd = await metered(); } catch {} }
  await c.close();
}
console.log(`${DRY ? 'ESTIMATED' : 'spent (computed)'} $${runUsd.toFixed(4)} over arms ${ARMS.join(',')}; envelope measured $${envUsd.toFixed(3)}`);
