#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/embed-site-pages.mjs — chunks the site's OWN prose
 * at ~1,600 chars per URL; it has no book/chapter context line and no page
 * attribution, and it writes to Supabase. Nothing chunks book pages.
 *
 * Arm (b) of #6173: passage chunks with a contextual prefix.
 *
 * A book's window is read as one text. Sentences are packed into chunks of
 * ~TARGET chars with one sentence of overlap, and a chunk may run across a page
 * break, which is the point: a page boundary cuts arguments mid-sentence. Each
 * chunk belongs to the page where it starts, and also names every page it
 * touches. A page's score is its best chunk.
 *
 * The prefix is one deterministic line of book and chapter context (title,
 * author, year, chapter). Anthropic's contextual retrieval has a model write
 * the line per chunk; that costs a generation call per chunk, like arm (c),
 * and is priced in the write-up rather than run here.
 *
 *   node --env-file=.env.production.local scripts/eval/embed-granularity/arm-b-chunks.mjs --dir DIR [--no-prefix]
 */
import fs from 'node:fs';
import path from 'node:path';
import { arg, flag, loadPool, embedAll, saveVecs } from './lib.mjs';

const DIR = arg('--dir');
const TARGET = Number(arg('--target', 1000));
const NOPREFIX = flag('--no-prefix');
const name = NOPREFIX ? 'b0' : 'b';
const pool = loadPool(DIR);

const byBook = new Map();
for (const p of pool) { if (!byBook.has(p.book_id)) byBook.set(p.book_id, []); byBook.get(p.book_id).push(p); }

const chunks = [];
for (const pages of byBook.values()) {
  // Sentences, each tagged with its page.
  const sents = [];
  for (const p of pages) {
    for (const s of p.text.split(/(?<=[.!?;:。！？])\s+/)) {
      // A "sentence" longer than the target (lists, verse without stops) is cut hard.
      for (let k = 0; k < s.length; k += TARGET) sents.push({ i: p.i, s: s.slice(k, k + TARGET) });
    }
  }
  let k = 0;
  while (k < sents.length) {
    let len = 0; let j = k;
    while (j < sents.length && (len === 0 || len + sents[j].s.length <= TARGET)) { len += sents[j].s.length + 1; j++; }
    const part = sents.slice(k, j);
    const first = pool[part[0].i];
    const prefix = NOPREFIX ? '' : `From "${first.title}"${first.author ? ` by ${first.author}` : ''}${first.year ? ` (${first.year})` : ''}${first.chapter ? `. Section: ${first.chapter}` : ''}.\n\n`;
    chunks.push({ c: chunks.length, i: part[0].i, pages: [...new Set(part.map((x) => x.i))], text: prefix + part.map((x) => x.s).join(' ') });
    if (j >= sents.length) break;
    k = Math.max(k + 1, j - 1); // one sentence of overlap
  }
}
const chars = chunks.reduce((s, c) => s + c.text.length, 0);
console.log(`${chunks.length} chunks, mean ${Math.round(chars / chunks.length)} chars, ${(chunks.length / pool.length).toFixed(2)} per page, ${chunks.filter((c) => c.pages.length > 1).length} cross a page break`);
fs.writeFileSync(path.join(DIR, `chunks-${name}.jsonl`), chunks.map((c) => JSON.stringify(c)).join('\n') + '\n');
if (flag('--dry')) process.exit(0);
const { vecs, tokens } = await embedAll(chunks.map((c) => c.text), { label: name, ckpt: path.join(DIR, `ckpt-${name}`) });
saveVecs(path.join(DIR, `vec-${name}.f32`), vecs);
fs.writeFileSync(path.join(DIR, `arm-${name}.json`), JSON.stringify({ chunks: chunks.length, chars, tokens }));
console.log(`arm ${name} written; ${tokens} tokens`);
