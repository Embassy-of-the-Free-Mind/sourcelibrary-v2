#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-levers/run-arms.mjs and scripts/eval/tengyur-arms/run-arms.mjs build
// production's one-page request (buildTranslationPrompt + PAGE_BREAK_SCOPED, pinned v13) for ONE Tengyur
// page set each; scripts/eval/tibetan-mt-ab/batch-arms.mjs submits such requests as Batch jobs from a
// Mongo id list. #6182 needs the same request over four page sets at once (the 58 + 113 Tengyur sides
// aligned to published translations, a fresh Tengyur reviewer sample, and the #5695 / #5873 reference
// pages in every other language), so this builds them into one units file that run-arms.mjs submits.
/**
 * units.mjs — read-only, $0. Writes /root/pareto-6182/units.jsonl, one row per page:
 *   { uid, set: 'tib-ref58'|'tib-ref113'|'tib-rev'|'xl', page_id, lang, prod_model, prompt, max_out, src_chars }
 * uid = page_id for Tengyur, the track's `<book>_<page>` id for xl. The prompt is the production request:
 * the pinned v13 prompt document (/root/tref/arms/state.json), the page's book record, the page's text,
 * PAGE_BREAK_SCOPED, one page, no context. Pages with no reference text (xl) are left out: they cannot
 * be judged.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/pareto-6182/units.mjs
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import path from 'node:path';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, getTranslateModelForBook } from '../../lib/translate-core.mjs';
import { maxOutputTokensFor } from '../../lib/translate-batch-seam.mjs';

const W = '/root/pareto-6182';
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const state = JSON.parse(fs.readFileSync('/root/tref/arms/state.json', 'utf8'));
if (Number(state.prompt_ref.version) !== 13) throw new Error('base prompt is not v13');
const prompt = (book, ocrText) => buildTranslationPrompt({ prompts: state.prompts, book, ocrText, pageBreak: PAGE_BREAK_SCOPED }).prompt;
const units = [];
const add = (set, uid, page_id, lang, book, text) => { if (!book || !text) throw new Error(`${set} ${uid}: no book or no text`); units.push({
  uid, set, page_id, lang, prod_model: getTranslateModelForBook(book), prompt: prompt(book, text),
  max_out: maxOutputTokensFor([{ ocr: { data: text } }]), src_chars: text.length,
}); };

// Tengyur, 58 sides aligned to Stcherbatsky / La Vallée Poussin (#6121): /root/tlev/ref-pages.jsonl.
const tlevBooks = JSON.parse(fs.readFileSync('/root/tlev/books.json', 'utf8'));
for (const r of jl('/root/tlev/ref-pages.jsonl')) add('tib-ref58', r.page_id, r.page_id, 'Tibetan', tlevBooks[r.book_id], r.bo);
// Tengyur, 113 sides aligned to 84000 (#5497): the page text the #5497 arms translated.
const trefBooks = JSON.parse(fs.readFileSync('/root/tref/pages/books.json', 'utf8'));
const tref = new Map(jl('/root/tref/ref/reference.jsonl').map((r) => [r.page_id, r]));
for (const s of JSON.parse(fs.readFileSync('scripts/eval/results/tengyur-ref-2026-10/judge/sample.json', 'utf8'))) {
  const r = tref.get(s.page_id);
  add('tib-ref113', r.page_id, r.page_id, 'Tibetan', trefBooks[String(r.vol)], r.src);
}
// Tengyur reviewer sample (#6182 stage 2), drawn by tengyur-levers/sample.mjs --round 3. Its volumes'
// book records are read from Mongo (the same projection as tengyur-levers/run-arms.mjs booksFor).
const rev = jl(path.join(W, 'rev', 'sample-pages.jsonl'));
const needBooks = [...new Set(rev.map((r) => r.book_id))].filter((id) => !tlevBooks[id]);
if (needBooks.length) {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  for (const d of await c.db('bookstore').collection('books').find({ id: { $in: needBooks } }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1 } }).toArray()) tlevBooks[d.id] = d;
  await c.close();
}
for (const r of rev) add('tib-rev', r.page_id, r.page_id, 'Tibetan', tlevBooks[r.book_id], r.bo);
// Every other language: the #5695 tracks and the #5873 top-up (load-xl.mjs), pages with a reference.
for (const r of jl(path.join(W, 'xl', 'records.jsonl'))) {
  if (!r.reference_text) continue;
  add('xl', r.id, r.id, r.lang, r.book, r.ocr_text);
}
const seen = new Set();
for (const u of units) { if (seen.has(u.uid)) throw new Error(`duplicate uid ${u.uid}`); seen.add(u.uid); }
fs.writeFileSync(path.join(W, 'units.jsonl'), units.map((u) => JSON.stringify(u)).join('\n') + '\n');
const by = {}; for (const u of units) { const k = `${u.set} ${u.prod_model}`; by[k] = (by[k] || 0) + 1; }
console.log(units.length, 'units', by, 'prompt chars', units.reduce((s, u) => s + u.prompt.length, 0));
