#!/usr/bin/env node
/**
 * Rebuild the July blind random baseline (784 corpus pages, retrieve/baseline-sample.mjs → baseline-classified.jsonl)
 * as classifier INPUT, by reading each page's translation back out of the local mirror (~/sl-corpus/books/<book>.jsonl).
 * The July file kept the classification but not the text; a second instrument (the aliveness classifier, #6652) needs
 * the same pages so its rates get the same denominator. Pages missing from the mirror are counted, not dropped silently.
 * PRIOR ART: retrieve/baseline-sample.mjs — draws the sample over the network; re-drawing would give a different sample,
 * and the point is to read the SAME 784 pages.
 *   node build/baseline-texts.mjs [in=baseline-classified.jsonl] [out=aliveness/baseline-input.jsonl]
 */
import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const HOME = process.env.HOME; const SL = path.join(HOME, 'sourcelibrary');
const CORPUS = process.env.SL_CORPUS || path.join(HOME, 'sl-corpus');
const EM = path.join(SL, 'scripts', 'output', 'experience-map');
const IN = process.argv[2] || path.join(EM, 'baseline-classified.jsonl');
const OUT = process.argv[3] || path.join(EM, 'aliveness', 'baseline-input.jsonl');
const { stripEditorialWrappers } = await import(path.join(SL, 'scripts', 'lib', 'strip-editorial-wrappers.mjs'));
const Database = createRequire(path.join(HOME, 'sourcelibrary-atlas', 'package.json'))('better-sqlite3');
const db = new Database(path.join(CORPUS, 'corpus.sqlite'), { readonly: true });
const catQ = db.prepare('SELECT visible FROM catalog WHERE id = ?');

const rows = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byBook = new Map(); for (const r of rows) { if (!byBook.has(r.book_id)) byBook.set(r.book_id, []); byBook.get(r.book_id).push(r); }
const out = fs.createWriteStream(OUT); let kept = 0, nofile = 0, nopage = 0, notr = 0;
for (const [b, list] of byBook) {
  const f = path.join(CORPUS, 'books', `${b}.jsonl`); if (!fs.existsSync(f)) { nofile += list.length; continue; }
  const pages = new Map(); for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l) continue; const p = JSON.parse(l); pages.set(p.p, p); }
  const vis = !!catQ.get(b)?.visible;
  for (const r of list) {
    const p = pages.get(r.page_number); if (!p) { nopage++; continue; } if (!p.tr) { notr++; continue; }
    out.write(JSON.stringify({ page_id: `${b}#${r.page_number}`, book_id: b, page_number: r.page_number, book_title: r.book_title, book_author: r.book_author, book_language: r.book_language, book_year: r.book_year, visible: vis, dim: 'RANDOM_BASELINE', slice: 'baseline', similarity: null, probe: null, text: stripEditorialWrappers(p.tr).trim().slice(0, 3000) }) + '\n'); kept++;
  }
}
out.end();
console.log(`${rows.length} baseline pages → ${kept} with text (no mirror file ${nofile}, page absent ${nopage}, no translation ${notr})`);
