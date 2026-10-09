#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-paired-arm.mjs (#5274) builds the production prompt per page through
// translate-core and runs lite/lite/flash, but over the Batch API, on the corpus-audit sample, with no thinking or
// no-context arm; scripts/eval/tibetan-mt-ab/gemini-arms.mjs is Tibetan-prompt-specific. This runs the #5695 T3 arms
// realtime (59 pages) on translation-vs-reference records, through scripts/lib/gemini-script-client.mjs, metered on
// the pseudo book_id `xlref-t3` (envelope `xlref-t3`, lane-restricted, cap $8). No writes to pages/books.
/** Run the #5695 T3 lever arms (lite ×2 noise floor, flash thinking 0 / budget, lite without context, optional corrected-OCR copies) through the production prompt door. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/xlref-t3/gemini-arms.mjs \
 *        --input <records.jsonl> --out <dir> --arms L1,L2,F0,FT,NC [--dump <dir>] [--override <jsonl of {book_id,page_number,source_text}>] [--suffix _fix] [--cap-usd 3]
 * Writes <dir>/raw/<arm><suffix>.jsonl (one row per page: text, prompt hash, model, thinkingConfig, tokens, usd). Resumable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import * as core from '../../lib/translate-core.mjs';
import { maxOutputTokensFor } from '../../lib/translate-batch-seam.mjs';
import { priceFor } from '../../lib/model-pricing.mjs';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { readJsonl, sha16, itemId } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const INPUT = opt('input'); const OUT = opt('out'); const SUFFIX = opt('suffix', ''); const CAP = Number(opt('cap-usd', 3));
const THINK = Number(opt('thinking-budget', 2048));
const ARMS = {
  L1: { model: core.MODEL_LITE, thinkingBudget: 0, context: true },   // production arm
  L2: { model: core.MODEL_LITE, thinkingBudget: 0, context: true },   // X1: the same again (noise floor)
  F0: { model: core.MODEL_FLASH, thinkingBudget: 0, context: true },  // lever: flash; X2 baseline
  FT: { model: core.MODEL_FLASH, thinkingBudget: THINK, context: true }, // X2: fixed thinking budget
  NC: { model: core.MODEL_LITE, thinkingBudget: 0, context: false },  // lever: no neighbour-page context
};
const want = opt('arms', 'L1,L2,F0,FT,NC').split(',');
const override = new Map((opt('override') ? readJsonl(opt('override')) : []).map((r) => [itemId(r), r.source_text]));
let records = readJsonl(INPUT);
if (override.size) records = records.filter((r) => override.has(itemId(r)));

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const prompts = await core.loadTranslationPrompts(db);
const jobs = [];
for (const r of records) {
  const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1, published: 1, 'image_source.provider': 1 } });
  const rows = await db.collection('pages').find({ book_id: r.book_id, page_number: { $in: [r.page_number - 1, r.page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
  const prev = rows.find((p) => p.page_number === r.page_number - 1); const next = rows.find((p) => p.page_number === r.page_number + 1);
  const ocr = override.get(itemId(r)) ?? r.source_text;
  for (const a of want) {
    const A = ARMS[a];
    const built = core.buildTranslationPrompt(A.context
      ? { prompts, book, ocrText: ocr, previousTranslation: prev?.translation?.data || null, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: core.PAGE_BREAK_SCOPED }
      : { prompts, book, ocrText: ocr, previousTranslation: null });
    jobs.push({ r, a, A, built, ocr, production_model: core.getTranslateModelForBook(book) });
  }
}
await c.close();

fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
if (opt('dump')) { // write the exact prompts (for the Opus ceiling arm, X3) and stop: no API call
  fs.mkdirSync(opt('dump'), { recursive: true });
  for (const j of jobs) fs.writeFileSync(path.join(opt('dump'), `${itemId(j.r)}.${j.a}.prompt.txt`), j.built.prompt);
  console.log(`dumped ${jobs.length} prompts`); process.exit(0);
}
const file = (a) => path.join(OUT, 'raw', `${a}${SUFFIX}.jsonl`);
const done = new Set();
for (const a of want) if (fs.existsSync(file(a))) for (const row of readJsonl(file(a))) done.add(`${a}:${row.id}`);
let usd = 0; let n = 0; let fail = 0;
const todo = jobs.filter((j) => !done.has(`${j.a}:${itemId(j.r)}`));
console.log(`${jobs.length} calls planned, ${todo.length} to run; prompt ${prompts.translation.ref.name} v${prompts.translation.ref.version}`);
async function run(j) {
  if (usd >= CAP) { fail++; return; }
  const p = priceFor(j.A.model);
  try {
    const res = await callGemini({ model: j.A.model, prompt: j.built.prompt, endpoint: 'scripts/eval/xlref-t3/gemini-arms.mjs', thinkingBudget: j.A.thinkingBudget, temperature: 1,
      maxOutputTokens: maxOutputTokensFor([{ ocr: { data: j.ocr } }]) + (j.A.thinkingBudget || 0), type: 'eval', bookId: 'xlref-t3', promptVersion: String(j.built.promptRef.version), triggeredBy: 'xlref-t3', safetySettings: core.SAFETY_SETTINGS });
    const cost = (res.inputTokens * p.input + res.outputTokens * p.output) / 1e6;
    usd += cost; n++;
    fs.appendFileSync(file(j.a), JSON.stringify({ id: itemId(j.r), book_id: j.r.book_id, page_number: j.r.page_number, lang: j.r.lang, arm: j.a + SUFFIX, model: j.A.model, thinkingConfig: { thinkingBudget: j.A.thinkingBudget }, context: j.A.context,
      prompt_name: j.built.promptRef.name, prompt_version: j.built.promptRef.version, prompt_sha: sha16(j.built.prompt), source_sha: sha16(j.ocr), page_break: j.built.pageBreak, production_model: j.production_model,
      input_tokens: res.inputTokens, output_tokens_billed: res.outputTokens, thinking_tokens: res.thinkingTokens, finish: res.finishReason, usd: +cost.toFixed(6), text: res.text, at: new Date().toISOString() }) + '\n');
  } catch (e) { fail++; console.log(`FAIL ${j.a} ${itemId(j.r)}: ${String(e.message).slice(0, 160)}`); }
}
const queue = [...todo];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()); }));
console.log(`ran ${n}, failed/skipped ${fail}, spent $${usd.toFixed(4)} (list price, realtime)`);
