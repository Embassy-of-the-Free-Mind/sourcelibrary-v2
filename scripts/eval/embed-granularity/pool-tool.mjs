#!/usr/bin/env node
/**
 * PRIOR ART: none — looked in scripts/eval/lib and scripts/eval/orig-lang-recall
 * (gold there is one drawn page per query, read straight from pool.jsonl).
 *
 * Reading tools for the #6173 gold set and relevance judging. Lexical only, so
 * finding gold passages does not use any of the embedding arms under test.
 *
 *   pool-tool.mjs --dir DIR grep '<regex>' [--tradition T] [--max 40]   one line per hit page, with a snippet
 *   pool-tool.mjs --dir DIR read <i> [<i> ...]                           full text of pool pages
 *   pool-tool.mjs --dir DIR books [--tradition T]                        the pool's books
 */
import fs from 'node:fs';
import path from 'node:path';
import { arg, loadPool } from './lib.mjs';

const DIR = arg('--dir');
const a = process.argv.slice(2).filter((x, k, all) => !x.startsWith('--') && !(all[k - 1] || '').startsWith('--'));
const [cmd, ...rest] = a;
const pool = loadPool(DIR);
const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
const T = arg('--tradition');
if (cmd === 'grep') {
  const re = new RegExp(rest[0], 'i');
  const max = Number(arg('--max', 40));
  const hits = pool.filter((p) => (!T || labels[p.book_id] === T) && re.test(p.text));
  console.log(`${hits.length} pages match (${[...new Set(hits.map((p) => labels[p.book_id]))].join(', ')})`);
  for (const p of hits.slice(0, max)) {
    const m = re.exec(p.text);
    console.log(`i=${p.i} [${labels[p.book_id]}] ${p.title.slice(0, 50)} p${p.page_number}: …${p.text.slice(Math.max(0, m.index - 110), m.index + 190)}…`);
  }
} else if (cmd === 'read') {
  for (const i of rest.map(Number)) {
    const p = pool[i];
    console.log(`\n===== i=${p.i} [${labels[p.book_id]}] "${p.title}" — ${p.author} (${p.year}), page ${p.page_number}${p.chapter ? `, section: ${p.chapter}` : ''}\n${p.text}`);
  }
} else if (cmd === 'books') {
  const seen = new Set();
  for (const p of pool) { if (seen.has(p.book_id) || (T && labels[p.book_id] !== T)) continue; seen.add(p.book_id); console.log(`[${labels[p.book_id]}] ${p.title.slice(0, 70)} — ${p.author.slice(0, 30)} (${p.language}) i=${p.i}..${p.i + pool.filter((x) => x.book_id === p.book_id).length - 1}`); }
} else { console.error('grep | read | books'); process.exit(1); }
