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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

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

// The book's own record goes into the prompt, fetched here with the internal full-tier key.
// A search that curls /api/books anonymously spends the machine's anonymous budget and, once
// it runs out, reads the crawler notice instead of the record (5 of 174 on 2026-10-28).
const KEY_FILE = [process.env.SL_INTERNAL_KEY_FILE, `${homedir()}/.sl-internal-key`, '/root/.sl-internal-key'].find((f) => f && existsSync(f));
const KEY = KEY_FILE ? readFileSync(KEY_FILE, 'utf8').trim() : null;
if (!KEY) console.error('No ~/.sl-internal-key: prompts will fall back to an anonymous curl of the record');

async function fetchRecord(id) {
  if (!KEY) return null;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://sourcelibrary.org/api/books/${id}`, { headers: { Authorization: `Bearer ${KEY}` } }).catch(() => null);
    if (r?.ok) return (await r.text()).slice(0, 4000);
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  return null;
}

function prompt(b, record) {
  const id = b.id || String(b._id);
  const read = record
    ? `The book's Source Library record (first 4,000 characters, already fetched; do not fetch sourcelibrary.org yourself):\n<<<\n${record}\n>>>\n`
    : `First read the book's summary: curl -s https://sourcelibrary.org/api/books/${id} | head -c 4000. `;
  return `Find out whether a published English translation already exists for this book. Source Library has machine-translated it.
Book: ${b.display_title || b.title || ''} | author: ${b.author || 'Anonymous'} | date: ${b.published || b.year || ''} | edition language: ${b.language || ''} | Source Library id ${id}.
${read}Identify the WORK. For a volume of a Chinese collection (卷), identify the specific juan or texts it contains.
Then use web search to look for any published English translation of the work, complete or substantial, from any year; one embedded in a scholarly edition counts. Search the original-language title, the English title, and the author with "translated". Look in WorldCat, Google Books, HathiTrust, Internet Archive, publisher sites and JSTOR. One legitimate prior translation settles it. Give up after about 8 searches. Excerpts or selected passages are partial_only, not a prior.
Report only URLs you actually opened. Never guess a URL.
Answer with ONLY a JSON object: {"id":"${id}","work_identified":"...","verdict":"prior_translation_found|partial_only|none_found|unclear","prior":{"translator":"","title":"","year":"","publisher":"","url":""} or null,"queries":["..."],"card":"1-3 sentence library card notice: 'Prior English translation: <translator>, <title> (<publisher>, <year>). <url>' or 'Searched <today's date> for an earlier English translation (<sources>); none found.'"}`;
}

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const searched = new Set(await db.collection('first_translation_attempts').distinct('book_id', { method: METHOD }));
// Books the old card system searched. Its "found" verdicts were mostly wrong (68 of 71 adjudicated
// conflicts went to the fresh search, 2026-10-28), so a book with an old search still needs one, but
// a book with no search at all comes first (Derek, 2026-10-28).
const oldSearched = new Set(await db.collection('first_translation_attempts').distinct('book_id', { method: { $ne: METHOD } }));
const pool = await db.collection('books').find(
  { visible: true, pages_translated: { $gt: 0 }, language: { $nin: ['English', 'english', 'en', 'eng'] } },
  { projection: { id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, language: 1, is_first_translation: 1, prior_translation: 1 } },
).toArray();
const eligible = pool.filter((b) => !searched.has(b.id || String(b._id)));
// Priority tiers, each shuffled: 0 never searched; 1 searched by the old system, no badge or credit;
// 2 already badged or credited (a fresh search there only adds evidence).
const tier = (b) => (!oldSearched.has(b.id || String(b._id)) ? 0 : b.is_first_translation || b.prior_translation ? 2 : 1);
const tiers = [0, 1, 2].map((t) => shuffle(eligible.filter((b) => tier(b) === t), SEED + t));
const batch = tiers.flat().slice(0, N);
console.log(`tiers: never searched ${tiers[0].length}, old search unmarked ${tiers[1].length}, badged/credited ${tiers[2].length}`);

mkdirSync(OUT, { recursive: true });
let missing = 0;
for (let i = 0; i < batch.length; i += 8) {
  await Promise.all(batch.slice(i, i + 8).map(async (b) => {
    const record = await fetchRecord(b.id || String(b._id));
    if (!record) missing++;
    writeFileSync(`${OUT}/${b.id || String(b._id)}.prompt`, prompt(b, record));
  }));
}
if (missing) console.error(`${missing} records not fetched; those prompts curl the record themselves`);
writeFileSync(`${OUT}/ids.txt`, batch.map((b) => b.id || String(b._id)).join('\n') + '\n');
writeFileSync(`${OUT}/batch.json`, JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), eligible: eligible.length, n: batch.length }, null, 1));
console.log(`eligible ${eligible.length} (of ${pool.length} translated non-English visible); wrote ${batch.length} prompts to ${OUT} (seed ${SEED})`);
await c.close();
