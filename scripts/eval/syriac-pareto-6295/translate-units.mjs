#!/usr/bin/env node
// PRIOR ART: scripts/eval/pareto-6182/units.mjs — production's one-page translation request (pinned v13 prompt
// document, buildTranslationPrompt + PAGE_BREAK_SCOPED, one page, no context), used here unchanged; it reads the
// #6182 page sets, and #6295 translates two SOURCES of the same sealed page, so this writes one units file per source.
/**
 * translate-units.mjs — read-only, $0. Writes <work>/units-R.jsonl (the reference window, refs/<slug>.txt) and
 * <work>/units-K.jsonl (the served Kraken lane text, what production would translate). Pages with no reference
 * window are left out of both: they cannot be judged.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/syriac-pareto-6295/translate-units.mjs --work <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../../lib/mongo.mjs';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, getTranslateModelForBook } from '../../lib/translate-core.mjs';
import { maxOutputTokensFor } from '../../lib/translate-batch-seam.mjs';

const W = process.argv[process.argv.indexOf('--work') + 1];
const state = JSON.parse(fs.readFileSync('/root/tref/arms/state.json', 'utf8'));
if (Number(state.prompt_ref.version) !== 13) throw new Error('base prompt is not v13');
const pages = JSON.parse(fs.readFileSync(path.join(W, 'seal', 'pages.json'), 'utf8'));
let books;
await withMongo(async (db) => {
  books = Object.fromEntries((await db.collection('books').find({ id: { $in: pages.map((p) => p.bid) } },
    { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1 } }).toArray()).map((b) => [b.id, b]));
});
const units = { R: [], K: [] };
for (const p of pages) {
  const ref = path.join(W, 'refs', `${p.slug}.txt`);
  if (!fs.existsSync(ref)) continue;
  const book = books[p.bid];
  const src = { R: fs.readFileSync(ref, 'utf8').trim(), K: fs.readFileSync(path.join(W, 'seal', 'pages', p.slug, 'served-ocr.txt'), 'utf8') };
  for (const [k, text] of Object.entries(src)) units[k].push({
    uid: p.slug, source: k, prod_model: getTranslateModelForBook(book),
    prompt: buildTranslationPrompt({ prompts: state.prompts, book, ocrText: text, pageBreak: PAGE_BREAK_SCOPED }).prompt,
    max_out: maxOutputTokensFor([{ ocr: { data: text } }]), src_chars: text.length,
  });
}
for (const [k, us] of Object.entries(units)) fs.writeFileSync(path.join(W, `units-${k}.jsonl`), us.map((u) => JSON.stringify(u)).join('\n') + '\n');
console.log(units.R.length, 'pages; production model', [...new Set(units.R.map((u) => u.prod_model))], 'prompt v13 chars', units.R[0]?.prompt.length);
