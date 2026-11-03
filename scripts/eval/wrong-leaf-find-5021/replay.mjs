#!/usr/bin/env node
// PRIOR ART: scripts/eval/block-guard-5021/sample-blocks.mjs + score.mjs (fresh agy blocks scored by the guard; no
// natural shifted block, no one-page reference, no counterfactual), scripts/lib/translate-core.mjs
// buildBlockTranslationPrompt / buildTranslationPrompt / parseBlockTranslations (the prompts and parser replayed here,
// unchanged) and scripts/lib/block-drift.mjs dropDriftedPages (the guard, unchanged). This replays the SAME blocks that
// slid in production, beside clean ones, to ask whether the slide recurs and what triggers it (#5021 part A).
/**
 *   node --env-file=.env.production.local scripts/eval/wrong-leaf-find-5021/replay.mjs BLOCKS.jsonl OUT_DIR [--arms a,b] [--concurrency 6]
 * BLOCKS.jsonl: {id, book_id, pages: [n…], kind: 'shifted'|'clean', ...}. Read-only on Mongo; writes OUT_DIR/calls.jsonl
 * (one line per call, raw reply kept) and a gemini_usage row per call (callGemini). Resumable per (block, arm, rep).
 * Arms at the model's default temperature (1.0) and thinking default, as the April worker sent them. block and nohr on
 * --model (default gemini-3.1-flash-lite-preview, the model of the natural cases); single and anchor on --ref-model
 * (default gemini-3.1-flash-lite: the preview is not in model-pricing.mjs and meters at the $1.5/$9 default, 6x).
 *   block   the block prompt as the worker sends it (translate-core buildBlockTranslationPrompt: "--- Page N ---" then
 *           the raw transcription; reply <translation page="N">). Same block text as the worker's April prompt. 2 reps
 *           for kind 'shifted', 1 for 'clean'.
 *   nohr    the same, with every rule line inside a page's transcription ("---", "***", "___") removed: the counterfactual
 *           for "the model reads an in-page rule as a page break". Only for blocks with such a line. 2 reps.
 *   anchor  block + block-page-guard anchorRule (today's guarded prompt, tag form); the guard's refusals are recorded.
 *   single  one call per page, block pages and the page either side (the reference: a one-page call cannot slide).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { loadTranslationPrompts, buildBlockTranslationPrompt, buildTranslationPrompt } from '../../lib/translate-core.mjs';
import { anchorRule, stripAnchor } from '../../lib/block-page-guard.mjs';

const argv = process.argv.slice(2);
const [BLOCKS, OUT] = argv;
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const ARMS = opt('arms', 'single,block,nohr,anchor').split(',');
const MODEL = opt('model', 'gemini-3.1-flash-lite-preview');
const REF_MODEL = opt('ref-model', 'gemini-3.1-flash-lite');
const CONC = Number(opt('concurrency', 6));
const ENDPOINT = 'scripts/eval/wrong-leaf-find-5021/replay.mjs';
fs.mkdirSync(OUT, { recursive: true });
const callsF = path.join(OUT, 'calls.jsonl');
const done = new Set(fs.existsSync(callsF) ? fs.readFileSync(callsF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.text != null).map((r) => r.key) : []);
// A markdown rule on a line of its own, as our OCR writes between sections of one leaf.
export const RULE_LINE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm;
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({ category, threshold: 'BLOCK_NONE' }));

const blocks = fs.readFileSync(BLOCKS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = c.db('bookstore');
const prompts = await loadTranslationPrompts(db);
const jobs = [];
for (const b of blocks) {
  const book = await db.collection('books').findOne({ id: b.book_id });
  const lo = Math.min(...b.pages) - 1, hi = Math.max(...b.pages) + 1;
  const ps = await db.collection('pages').find({ book_id: b.book_id, page_number: { $gte: lo, $lte: hi } }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  const by = new Map(ps.map((p) => [p.page_number, p]));
  const pages = b.pages.map((n) => by.get(n)).filter(Boolean);
  if (pages.length !== b.pages.length) { console.warn(`${b.id}: missing pages`); continue; }
  const hasRule = pages.some((p) => RULE_LINE.test(p.ocr?.data || ''));
  RULE_LINE.lastIndex = 0;
  const mk = (arm, rep, prompt, pageNums, extra = {}) => jobs.push({ key: `${b.id}|${arm}|${rep}|${pageNums.join(',')}`, block: b.id, arm, rep, pages: pageNums, prompt, book_id: b.book_id, model: arm === 'single' || arm === 'anchor' ? REF_MODEL : MODEL, ...extra });
  const reps = b.kind === 'shifted' ? [0, 1] : [0];
  if (ARMS.includes('single')) {
    for (const n of [lo, ...b.pages, hi]) {
      const p = by.get(n);
      if (!p?.ocr?.data) continue;
      mk('single', 0, buildTranslationPrompt({ prompts, book, ocrText: p.ocr.data }).prompt, [n]);
    }
  }
  const blockPrompt = (pp) => buildBlockTranslationPrompt({ prompts, book, pages: pp }).prompt;
  if (ARMS.includes('block')) for (const rep of reps) mk('block', rep, blockPrompt(pages), b.pages);
  if (ARMS.includes('nohr') && hasRule) {
    const stripped = pages.map((p) => ({ ...p, ocr: { data: p.ocr.data.replace(RULE_LINE, '') } }));
    for (const rep of reps) mk('nohr', rep, blockPrompt(stripped), b.pages);
  }
  if (ARMS.includes('anchor')) mk('anchor', 0, blockPrompt(pages) + anchorRule(b.pages), b.pages);
}
await c.close();
const todo = jobs.filter((j) => !done.has(j.key));
console.log(`${jobs.length} calls planned, ${todo.length} to run (${MODEL}; refs ${REF_MODEL})`);
let n = 0, usd = 0;
const worker = async () => {
  for (let j = todo.shift(); j; j = todo.shift()) {
    let row;
    try {
      const r = await callGemini({ model: j.model, prompt: j.prompt, endpoint: ENDPOINT, allowThinking: true, temperature: 1, maxOutputTokens: 32000, type: 'eval', bookId: j.book_id, promptVersion: `replay-5021-${j.arm}`, safetySettings: SAFETY });
      row = { key: j.key, block: j.block, arm: j.arm, rep: j.rep, model: j.model, pages: j.pages, text: r.text, finish: r.finishReason, in: r.inputTokens, out: r.outputTokens };
      if (j.arm === 'anchor') row.anchors = [...r.text.matchAll(/<translation\s+page="(\d+)">([\s\S]*?)<\/translation>/g)].map((m) => ({ page: Number(m[1]), ...stripAnchor(m[2]).anchor }));
    } catch (e) {
      row = { key: j.key, block: j.block, arm: j.arm, rep: j.rep, pages: j.pages, error: String(e.message).slice(0, 300) };
    }
    fs.appendFileSync(callsF, JSON.stringify(row) + '\n');
    if (++n % 25 === 0) console.log(new Date().toISOString(), n, 'calls');
  }
};
await Promise.all(Array.from({ length: CONC }, worker));
console.log('done', n);
