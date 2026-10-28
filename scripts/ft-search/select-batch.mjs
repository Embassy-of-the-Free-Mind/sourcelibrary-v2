#!/usr/bin/env node
// PRIOR ART: the 2026-10-28 1,000-book run (sourcelibrary-ops evals/ft-fresh-check-2026-10-28/run-1000),
// whose sample and prompts this reproduces as a script. scripts/eval/ft-* and the card harvest select for
// the retired card-review lane (#7598), not "every translated book without a fresh search".
//
// Select the next batch for the fresh prior-translation search (#7598) and write one prompt per book.
// A book is eligible when it is visible, has translated pages, is not English, and has no fresh-search
// attempt yet (method claude_subagent_verify). Random order, seeded, so a batch is reproducible.
//
//   set -a; source .env.production.local; set +a
//   node scripts/ft-search/select-batch.mjs --n 1000 --out <dir> [--seed 20261029]
import { MongoClient } from 'mongodb';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = parseInt(arg('--n', '1000'), 10);
const OUT = arg('--out');
const SEED = parseInt(arg('--seed', String(Date.now() % 1e8)), 10);
if (!OUT) { console.error('Missing --out <dir>'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

export const METHOD = 'claude_subagent_verify';

// Seeded shuffle (mulberry32), so a batch can be re-drawn exactly.
function shuffle(a, seed) {
  let t = seed >>> 0;
  const rnd = () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function prompt(b) {
  const id = b.id || String(b._id);
  return `Find out whether a published English translation already exists for this book. Source Library has machine-translated it.
Book: ${b.display_title || b.title || ''} | author: ${b.author || 'Anonymous'} | date: ${b.published || b.year || ''} | edition language: ${b.language || ''} | Source Library id ${id}.
First read the book's summary: curl -s https://sourcelibrary.org/api/books/${id} | head -c 4000. Identify the WORK. For a volume of a Chinese collection (卷), identify the specific juan or texts it contains.
Then use web search to look for any published English translation of the work, complete or substantial, from any year; one embedded in a scholarly edition counts. Search the original-language title, the English title, and the author with "translated". Look in WorldCat, Google Books, HathiTrust, Internet Archive, publisher sites and JSTOR. One legitimate prior translation settles it. Give up after about 8 searches. Excerpts or selected passages are partial_only, not a prior.
Report only URLs you actually opened. Never guess a URL.
Answer with ONLY a JSON object: {"id":"${id}","work_identified":"...","verdict":"prior_translation_found|partial_only|none_found|unclear","prior":{"translator":"","title":"","year":"","publisher":"","url":""} or null,"queries":["..."],"card":"1-3 sentence library card notice: 'Prior English translation: <translator>, <title> (<publisher>, <year>). <url>' or 'Searched <today's date> for an earlier English translation (<sources>); none found.'"}`;
}

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const searched = new Set(await db.collection('first_translation_attempts').distinct('book_id', { method: METHOD }));
const pool = await db.collection('books').find(
  { visible: true, pages_translated: { $gt: 0 }, language: { $nin: ['English', 'english', 'en', 'eng'] } },
  { projection: { id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, language: 1 } },
).toArray();
const eligible = pool.filter((b) => !searched.has(b.id || String(b._id)));
const batch = shuffle(eligible, SEED).slice(0, N);

mkdirSync(OUT, { recursive: true });
for (const b of batch) writeFileSync(`${OUT}/${b.id || String(b._id)}.prompt`, prompt(b));
writeFileSync(`${OUT}/ids.txt`, batch.map((b) => b.id || String(b._id)).join('\n') + '\n');
writeFileSync(`${OUT}/batch.json`, JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), eligible: eligible.length, n: batch.length }, null, 1));
console.log(`eligible ${eligible.length} (of ${pool.length} translated non-English visible); wrote ${batch.length} prompts to ${OUT} (seed ${SEED})`);
await c.close();
