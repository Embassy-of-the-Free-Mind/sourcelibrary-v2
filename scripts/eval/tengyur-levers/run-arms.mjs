#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-arms/run-arms.mjs (#5497, PR #5713) rebuilds production's one-page
// Tengyur request (buildTranslationPrompt + PAGE_BREAK_SCOPED, pinned v13 prompt document in
// /root/tref/arms/state.json) and runs lever arms realtime through gemini-script-client. Its page set is
// the 113 84000-referenced sides and its levers (glossary, Sanskrit, thinking, Pro fix pass) are done;
// #6121 needs the same base request on a new sample with two new levers (previous-sides context, a Pro
// translator), so this keeps its request, call, ledger and cap code and changes the page source and arms.
/**
 * run-arms.mjs — arms of #6121. Eval only: outputs go to <work>/arms/<ARM>.jsonl, NEVER to pages.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tengyur-levers/run-arms.mjs \
 *        --arm A|C|P|PC [--pages sample|ref] [--cap-usd 5] [--conc 6] [--probe <n>]
 *
 *   A   production again: gemini-3-flash-preview, v13, one page, no context, thinking 0 (A-vs-A floor).
 *   C   A + read-only context: the text's Tohoku number and titles, and the two previous sides' Tibetan.
 *   P   gemini-3.1-pro-preview, the production request unchanged, thinking budget PRO_THINK.
 *   PC  P + C's context.
 * --probe n: run P on n pages that are NOT in the sample (pricing only; written to probe.jsonl).
 * Spend: --cap-usd is checked against <work>/ledger.jsonl (every arm and probe) before every call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, sanitizeTranslationTags, SAFETY_SETTINGS } from '../../lib/translate-core.mjs';
import { maxOutputTokensFor } from '../../lib/translate-batch-seam.mjs';
import { costOf, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';
import { callGemini } from '../../lib/gemini-script-client.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const WORK = opt('work', '/root/tlev');
const ARM = opt('arm');
const CAP = Number(opt('cap-usd', 5));
const CONC = Number(opt('conc', 6));
const PROBE = Number(opt('probe', 0));
const FLASH = 'gemini-3-flash-preview';
const PRO = 'gemini-3.1-pro-preview';
export const PRO_THINK = 128; // the lowest budget Pro accepts; billed thinking is recorded per call
const ENDPOINT = 'eval/tengyur-levers-6121';
const ARMS = { A: { model: FLASH, ctx: false }, C: { model: FLASH, ctx: true }, P: { model: PRO, ctx: false }, PC: { model: PRO, ctx: true } };
fs.mkdirSync(path.join(WORK, 'arms'), { recursive: true });

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const LEDGER = path.join(WORK, 'ledger.jsonl');
let spent = readJsonl(LEDGER).reduce((n, r) => n + r.usd, 0);

const state = JSON.parse(fs.readFileSync('/root/tref/arms/state.json', 'utf8'));
if (Number(state.prompt_ref.version) !== 13) throw new Error('base prompt is not v13');

export const CONTEXT_HEAD = '**Context (read-only; do NOT translate it).** The page above is part of the text named below, and the two sides of the woodblock that come before it are given so that you can tell who is speaking (the author, an opponent or objector, a quoted root text or scripture) and how the argument runs. Translate ONLY the "Text to translate" above, from its first word to its last. Do not translate, summarise or repeat anything from these previous sides; if the page begins in the middle of a sentence, the English begins in the middle of that sentence too.';
export function contextBlock(r) {
  const t = r.titles || {};
  const name = [`Tohoku ${r.text_toh || '?'}`, t.tibetan ? `Tibetan title: ${t.tibetan}` : null, t.sanskrit ? `Sanskrit title (in Tibetan script): ${t.sanskrit}` : null].filter(Boolean).join('; ');
  return `\n\n${CONTEXT_HEAD}\n\nText: ${name}\n\n--- Two sides before this page (context only) ---\n${r.prev2}\n\n--- The side just before this page (context only) ---\n${r.prev1}`;
}

async function call({ model, prompt, maxOutputTokens, r, arm }) {
  const pro = model === PRO;
  const estIn = prompt.length / 2.5, estOut = maxOutputTokens * 0.3 + (pro ? 3000 : 0);
  const est = costOf(model, estIn, estOut);
  if (spent + est > CAP) throw new Error(`CAP: spent $${spent.toFixed(3)} + est $${est.toFixed(3)} > $${CAP}`);
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await callGemini({
        model, prompt, endpoint: ENDPOINT, type: 'eval', bookId: r.book_id, pageIds: [r.page_id], promptVersion: 'v13',
        triggeredBy: 'tengyur-levers-6121', safetySettings: SAFETY_SETTINGS, maxOutputTokens,
        temperature: 1.0, // the stored English ran in the Batch API at Gemini 3's default temperature
        thinkingBudget: pro ? PRO_THINK : 0,
      });
      const usd = costOf(model, res.inputTokens, res.outputTokens);
      spent += usd;
      fs.appendFileSync(LEDGER, JSON.stringify({ arm, page_id: r.page_id, model, in: res.inputTokens, out: res.outputTokens, thinking: res.thinkingTokens, usd, at: new Date().toISOString() }) + '\n');
      if (!res.text) throw new Error(`empty ${r.page_id} (${res.finishReason})`);
      return { ...res, usd, batch_usd: usd * BATCH_MULTIPLIER };
    } catch (e) {
      last = e;
      if (String(e.message).startsWith('CAP')) throw e;
      await new Promise((s) => setTimeout(s, 3000 * (attempt + 1)));
    }
  }
  throw last;
}

async function pool(items, fn) {
  const q = [...items]; const errs = [];
  await Promise.all(Array.from({ length: CONC }, async () => {
    for (let it = q.shift(); it; it = q.shift()) {
      try { await fn(it); } catch (e) { errs.push(String(e.message)); if (String(e.message).startsWith('CAP')) q.length = 0; }
    }
  }));
  return errs;
}

async function booksFor(rows) {
  const f = path.join(WORK, 'books.json');
  const have = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  const need = [...new Set(rows.map((r) => r.book_id))].filter((id) => !have[id]);
  if (need.length) {
    const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
    const docs = await c.db('bookstore').collection('books').find({ id: { $in: need } }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1 } }).toArray();
    for (const d of docs) have[d.id] = d;
    await c.close();
    fs.writeFileSync(f, JSON.stringify(have, null, 1));
  }
  return have;
}

async function probeRows(n) {
  // Pages of the same sections that are NOT in the sample: the next pages after sample pages + 3.
  const sample = readJsonl(path.join(WORK, 'sample-pages.jsonl'));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const out = [];
  for (const s of sample.slice(0, n)) {
    const p = await c.db('bookstore').collection('pages').findOne({ book_id: s.book_id, page_number: s.page_number + 3 }, { projection: { id: 1, 'ocr.data': 1 } });
    out.push({ ...s, page_id: p.id, page_number: s.page_number + 3, bo: p.ocr.data });
  }
  await c.close();
  return out;
}

async function main() {
  const cfg = PROBE ? ARMS.P : ARMS[ARM];
  if (!cfg) { console.error('--arm A|C|P|PC'); process.exit(1); }
  const name = PROBE ? 'probe-P' : ARM;
  const src = opt('pages', 'sample') === 'ref' ? 'ref-pages.jsonl' : 'sample-pages.jsonl';
  const rows = PROBE ? await probeRows(PROBE) : readJsonl(path.join(WORK, src));
  const books = await booksFor(rows);
  const file = path.join(WORK, 'arms', `${name}${src === 'ref-pages.jsonl' ? '-ref' : ''}.jsonl`);
  const done = new Set(readJsonl(file).map((x) => x.page_id));
  const targets = rows.filter((r) => !done.has(r.page_id));
  console.log(`${name}: ${targets.length} pages to do (${done.size} done); spent so far $${spent.toFixed(3)} of $${CAP}`);
  const errs = await pool(targets, async (r) => {
    let prompt = buildTranslationPrompt({ prompts: state.prompts, book: books[r.book_id], ocrText: r.bo, pageBreak: PAGE_BREAK_SCOPED }).prompt;
    if (cfg.ctx) prompt += contextBlock(r);
    const maxOutputTokens = maxOutputTokensFor([{ ocr: { data: r.bo } }]) + (cfg.model === PRO ? 8192 : 0);
    const res = await call({ model: cfg.model, prompt, maxOutputTokens, r, arm: name });
    const text = sanitizeTranslationTags(res.text.trim());
    fs.appendFileSync(file, JSON.stringify({ page_id: r.page_id, arm: name, text, gen: { model: cfg.model, in: res.inputTokens, out: res.outputTokens, thinking: res.thinkingTokens, usd: res.usd, batch_usd: res.batch_usd, finish: res.finishReason, thinkingConfig: { thinkingBudget: cfg.model === PRO ? PRO_THINK : 0 }, prompt_chars: prompt.length } }) + '\n');
  });
  const out = readJsonl(file);
  const usd = out.reduce((s, x) => s + x.gen.usd, 0);
  console.log(`${name}: ${out.length} pages; errors ${errs.length}${errs.length ? ` (${[...new Set(errs)].slice(0, 3).join(' | ')})` : ''}; arm $${usd.toFixed(3)} (${(usd / out.length * 1000).toFixed(2)}/1K realtime); run total $${spent.toFixed(3)}`);
}
await main();
