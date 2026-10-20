#!/usr/bin/env node
// PRIOR ART: scripts/eval/pareto-6182/units.mjs (the one-page production request #6545 sent: pinned v13 prompt,
// the record's book fields, PAGE_BREAK_SCOPED, no context) and scripts/lib/translate-core.mjs
// buildBlockTranslationPrompt (production's multi-page request, `<translation page="N">` per page). Neither builds a
// run of consecutive pages around a #6545 anchor page, so this does, from the same pieces.
/**
 * load-runs.mjs — read-only, $0, no model call. For each #6690 run (a #6545 anchor page and the 9 pages after it,
 * one book per language) writes, under $W (default $JOB_SCRATCH/w):
 *   pages.jsonl      {uid, run, lang, book_id, page_number, anchor, ocr_text, source_prev_tail, source_next_head}
 *   req/O1.jsonl     the one-page request per page: units.mjs's prompt + #6545's TRANSLATE_SUFFIX (the OPUS arm)
 *   req/O10.jsonl    one request per run: buildBlockTranslationPrompt over its 10 pages + the block suffix below
 * The anchor's one-page prompt is checked byte-for-byte against /root/pareto-6182/units.jsonl, so the #6545 OPUS
 * output for it is the same request and is reused.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/opus10-6690/load-runs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, buildBlockTranslationPrompt } from '../../lib/translate-core.mjs';

const W = process.env.W6690 || path.join(process.env.JOB_SCRATCH || '/tmp', 'w');
export const RUNS = [
  { run: 'fa', lang: 'Persian', anchor: '69e748bd49abba5e982816d3_00076' },  // Golestān, Rehatsek 1888
  { run: 'sa', lang: 'Sanskrit', anchor: '69ea3e63300d991d0f1d3186_00160' }, // Arthaśāstra, Shamasastry 1915
  { run: 'zh', lang: 'Chinese', anchor: '69e792fd80b52390feb1770f_00022' },  // Sanguo yanyi, Brewitt-Taylor 1925
  { run: 'grc', lang: 'Greek', anchor: '699376d2b0a84a5763961a97_00367' },   // Republic IX, Jowett 1892
  { run: 'he', lang: 'Hebrew', anchor: '69b52593cced70d8e6d72941_00037' },   // Sefer ha-Yirah, Kerber 2007
];
const N = 10;
// #6545 prompts.py TRANSLATE_SUFFIX, verbatim (the one-page arm).
const SENTINEL = 'Write the translation between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.';
const SUFFIX1 = `\n\nDo not open, read or write any file and do not use any tool: the text is above. ${SENTINEL}\n`;
// The same suffix for a block: the markers wrap all the <translation page="N"> blocks.
const SUFFIX10 = `\n\nDo not open, read or write any file and do not use any tool: the text is above. Write all ${N} page translations, each in its own <translation page="N">…</translation> block, in page order, between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.\n`;

const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pad = (n) => String(n).padStart(5, '0');

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = JSON.parse(fs.readFileSync('/root/tref/arms/state.json', 'utf8'));
  if (Number(state.prompt_ref.version) !== 13) throw new Error('base prompt is not v13');
  const records = new Map(jl('/root/pareto-6182/xl/records.jsonl').map((r) => [r.id, r]));
  const units = new Map(jl('/root/pareto-6182/units.jsonl').map((u) => [u.uid, u]));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const pages = [], o1 = [], o10 = [];
  for (const R of RUNS) {
    const rec = records.get(R.anchor); const book = rec.book; const p0 = Number(rec.page_number);
    const docs = await db.collection('pages').find({ book_id: rec.book_id, page_number: { $gte: p0 - 1, $lte: p0 + N } },
      { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
    const by = new Map(docs.map((d) => [d.page_number, d.ocr?.data || '']));
    const run = [];
    for (let k = 0; k < N; k++) {
      const pn = p0 + k; const uid = `${rec.book_id}_${pad(pn)}`;
      let text = by.get(pn);
      if (!text) throw new Error(`${uid}: no OCR`);
      if (k === 0) {
        if (text !== rec.ocr_text) console.log(`${uid}: Mongo OCR drifted from the #6545 record; using the record's`);
        text = rec.ocr_text;
      }
      run.push({ uid, run: R.run, lang: R.lang, book_id: rec.book_id, page_number: pn, anchor: k === 0, ocr_text: text });
    }
    // what the judge sees of the neighbouring pages (as #6545's source_prev_tail / source_next_head)
    run.forEach((p, k) => {
      const prev = k ? run[k - 1].ocr_text : by.get(p0 - 1); const next = k + 1 < N ? run[k + 1].ocr_text : by.get(p0 + N);
      p.source_prev_tail = k ? prev.slice(-400) : (rec.source_prev_tail || (prev || '').slice(-400));
      p.source_next_head = (next || '').slice(0, 400);
    });
    for (const p of run) {
      const prompt = buildTranslationPrompt({ prompts: state.prompts, book, ocrText: p.ocr_text, pageBreak: PAGE_BREAK_SCOPED }).prompt;
      if (p.anchor && prompt !== units.get(p.uid).prompt) throw new Error(`${p.uid}: one-page prompt differs from #6545's`);
      o1.push({ uid: p.uid, run: R.run, lang: R.lang, prompt: prompt + SUFFIX1 });
    }
    const block = buildBlockTranslationPrompt({ prompts: state.prompts, book, pages: run.map((p) => ({ page_number: p.page_number, ocr: p.ocr_text })),
      prevOcrText: by.get(p0 - 1) || undefined, nextOcrText: by.get(p0 + N) || undefined, pageBreak: PAGE_BREAK_SCOPED });
    o10.push({ uid: `${R.run}-block`, run: R.run, lang: R.lang, pages: run.map((p) => p.page_number), page_uids: run.map((p) => p.uid), prompt: block.prompt + SUFFIX10 });
    pages.push(...run);
    console.log(R.run, R.lang, book.title.slice(0, 40), `p.${p0}-${p0 + N - 1}`, 'src chars', run.reduce((s, p) => s + p.ocr_text.length, 0), 'block prompt chars', block.prompt.length, 'page-break applied', block.pageBreak?.applied);
  }
  await c.close();
  fs.mkdirSync(path.join(W, 'req'), { recursive: true });
  const wr = (f, rows) => fs.writeFileSync(path.join(W, f), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  wr('pages.jsonl', pages); wr('req/O1.jsonl', o1); wr('req/O10.jsonl', o10);
  console.log(pages.length, 'pages;', o1.length, 'one-page and', o10.length, 'block requests in', W);
}
