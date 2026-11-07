#!/usr/bin/env node
// PRIOR ART: scripts/eval/severity-cal-7263/read.mjs (open PR #8136): the same fresh agy Flash-low read through
// cli-ocr.mjs read (kept through candidate-reads; the first QUOTA/LOCKED line stops it). Restated because its page
// list is its own sample.json; this one draws 2 of the 5 judged pages of each #7866 book.
/**
 * Family R of #7263 book-grade-model: a fresh agy gemini-3.8-flash-low read of 2 judged pages per #7866 book (320),
 * to compare with the stored text. Writes no page or book. Cap: 400 reads with retries (the brief).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/book-grade-7263/agy.mjs run
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeRng } from '../lib/paired-stats.mjs';
import { OUT, ROOT, SEED, J } from './lib.mjs';

export const MODEL = 'gemini-3.8-flash-low';
export const DIR = path.join(OUT, 'agy');
const CAP = 400;

/** 2 of each #7866 book's judged pages, by page_id order shuffled with SEED.agy. Lockbox books included (a feature). */
export function agyPages(rows) {
  const rng = makeRng(SEED.agy);
  const byBook = new Map();
  for (const r of rows.filter((x) => x.study === '7866').sort((a, b) => (a.page_id < b.page_id ? -1 : 1))) (byBook.get(r.book_id) ?? byBook.set(r.book_id, []).get(r.book_id)).push(r.page_id);
  const out = [];
  for (const b of [...byBook.keys()].sort()) {
    const ps = [...byBook.get(b)];
    for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
    out.push(...ps.slice(0, 2));
  }
  return out;
}

if (process.argv[2] === 'run') {
  const ids = agyPages(J('labels.json.gz').rows);
  fs.mkdirSync(DIR, { recursive: true });
  const done = fs.readdirSync(DIR).filter((f) => f.endsWith('.meta.json')).length;
  if (done >= CAP) { console.log(`cap reached: ${done} metas`); process.exit(0); }
  fs.writeFileSync(path.join(DIR, 'ids.json'), JSON.stringify(ids));
  console.log(`${ids.length} pages, ${done} already read`);
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/batch/cli-ocr.mjs'), 'read', `--page-ids-file=${path.join(DIR, 'ids.json')}`, `--out=${DIR}`, `--model=${MODEL}`, '--job=book-grade-model-7263', '--concurrency=3', '--stop-on-quota'],
      { env: process.env, cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', (d) => { process.stdout.write(d); if (/QUOTA at|LOCKED at/.test(String(d))) { fs.writeFileSync(path.join(OUT, 'agy-stopped.txt'), `${new Date().toISOString()} ${String(d).trim()}\n`); child.kill('SIGTERM'); } });
    child.on('close', resolve);
  });
}
