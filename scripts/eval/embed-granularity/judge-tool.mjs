#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/lib/contact-sheet.mjs — image contact sheets for
 * by-eye OCR review; nothing shows text pages to a relevance judge with the
 * arm hidden.
 *
 * Shows the #6173 judging queue to a reader, one batch at a time. Pages come in
 * pool-index order with no arm and no rank, so the reader cannot tell which
 * method retrieved a page. Text is cut at 3,500 characters.
 *
 *   judge-tool.mjs --dir DIR list                 queries and batch counts
 *   judge-tool.mjs --dir DIR show <qid> <batch>   batch (1-based) of 12 pages
 */
import fs from 'node:fs';
import path from 'node:path';
import { arg, loadPool } from './lib.mjs';

const DIR = arg('--dir');
const a = process.argv.slice(2).filter((x, k, all) => !x.startsWith('--') && !(all[k - 1] || '').startsWith('--'));
const queue = JSON.parse(fs.readFileSync(path.join(DIR, 'judge-queue.json'), 'utf8'));
const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
const B = 12;
if (a[0] === 'list') {
  for (const q of queue) console.log(`${q.qid}: ${q.pages.length} pages, ${Math.ceil(q.pages.length / B)} batches — ${q.query}`);
} else if (a[0] === 'show') {
  const pool = loadPool(DIR);
  const q = queue.find((x) => x.qid === a[1]);
  const b = Number(a[2]);
  const pages = q.pages.slice((b - 1) * B, b * B);
  console.log(`QUERY ${q.qid}: "${q.query}" — batch ${b}/${Math.ceil(q.pages.length / B)}, ${pages.length} pages`);
  for (const i of pages) {
    const p = pool[i];
    console.log(`\n===== i=${i} | shelf label: ${labels[p.book_id]} | "${p.title.slice(0, 80)}" — ${p.author.slice(0, 40)} | page ${p.page_number}\n${p.text.slice(0, 3500)}`);
  }
} else { console.error('list | show <qid> <batch>'); process.exit(1); }
