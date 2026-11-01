#!/usr/bin/env node
/**
 * Women authors baseline (#7908) — how many works by women do we hold?
 *
 * PRIOR ART: scripts/maintenance/fetch-wikidata-claims.mjs — same batched
 *   wbgetentities walk over authors.wikidata_id, but it WRITES a durable
 *   `wikidata_claims` collection and does not fetch P21. This audit must stay
 *   read-only (the issue forbids a gender field anywhere in Mongo, and a new
 *   collection a nightly rebuild could join is the same field by another name),
 *   so it caches to a local file instead.
 *
 * READ-ONLY. Reads `authors` and `books`; writes nothing to Mongo. The P21
 * cache is a local JSON file (default $JOB_SCRATCH or /tmp) so a re-run is free.
 *
 * Women = P21 ∈ {Q6581072 female, Q1052281 trans woman}. Coverage limit: authors
 * with no wikidata_id are unknown, and so are QIDs whose item has no P21 —
 * both are reported, never guessed from a name.
 *
 * Books join on books.author_id → authors._id (author-identity.md). Live =
 * visible:true && pages_count>0. Translated = readable_in_english
 * (translation-state.md, READABLE_IN_ENGLISH_FILTER).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/women-authors-baseline.mjs \
 *     [--cache /path/p21.json] [--out report.json] [--md report.md]
 */
import { MongoClient } from 'mongodb';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { READABLE_IN_ENGLISH_FILTER } from '../lib/page-counts.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const SCRATCH = process.env.JOB_SCRATCH || '/tmp';
const CACHE = arg('--cache', `${SCRATCH}/wikidata-p21-cache.json`);
const OUT = arg('--out', null);
const MD = arg('--md', null);
const UA = 'SourceLibraryBot/1.0 (https://sourcelibrary.org; hello@sourcelibrary.org) women-authors-baseline';
const BATCH = 50;
const SLEEP_MS = 1200;
const WOMEN = new Set(['Q6581072', 'Q1052281']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

async function fetchP21(ids) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en&ids=${ids.join('|')}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429 || r.status >= 500) { await sleep(10000 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const out = {};
      for (const id of ids) {
        const e = j.entities?.[id];
        // A redirected QID comes back under its target id; record it as unknown
        // rather than following silently.
        if (!e || e.missing !== undefined) { out[id] = { p21: null, missing: true }; continue; }
        const p21 = (e.claims?.P21 || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
        out[id] = { p21, label: e.labels?.en?.value || null };
      }
      // Redirects: entities keyed by target; map back via `redirects` if present.
      for (const [k, e] of Object.entries(j.entities || {})) {
        if (!ids.includes(k) && e.redirects?.from && ids.includes(e.redirects.from)) {
          const p21 = (e.claims?.P21 || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
          out[e.redirects.from] = { p21, label: e.labels?.en?.value || null, redirect: k };
        }
      }
      return out;
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(5000);
    }
  }
  throw new Error('wbgetentities: retries exhausted');
}

const mc = new MongoClient(uri, { maxPoolSize: 3 });
await mc.connect();
const db = mc.db('bookstore');

const authors = await db.collection('authors')
  .find({}, { projection: { _id: 1, canonical_name: 1, slug: 1, wikidata_id: 1 } }).toArray();
const withQid = authors.filter((a) => typeof a.wikidata_id === 'string' && /^Q\d+$/.test(a.wikidata_id));

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const todo = [...new Set(withQid.map((a) => a.wikidata_id))].filter((q) => !(q in cache));
console.error(`authors ${authors.length}; with QID ${withQid.length}; to fetch ${todo.length}`);
for (let i = 0; i < todo.length; i += BATCH) {
  Object.assign(cache, await fetchP21(todo.slice(i, i + BATCH)));
  if ((i / BATCH) % 20 === 0) { writeFileSync(CACHE, JSON.stringify(cache)); console.error(`  fetched ${i + BATCH}/${todo.length}`); }
  await sleep(SLEEP_MS);
}
writeFileSync(CACHE, JSON.stringify(cache));

const women = [];
let noP21 = 0;
let missing = 0;
for (const a of withQid) {
  const c = cache[a.wikidata_id];
  if (!c || c.missing) { missing++; continue; }
  if (!c.p21.length) { noP21++; continue; }
  if (c.p21.some((p) => WOMEN.has(p))) women.push(a);
}
const womenIds = women.map((a) => a._id);

const LIVE = { visible: true, pages_count: { $gt: 0 } };
const books = db.collection('books');
const byAuthor = new Map();
const cursor = books.find({ author_id: { $in: womenIds } },
  { projection: { author_id: 1, visible: 1, pages_count: 1, translation_state: 1, language: 1 } });
const readableIds = new Set((await books.find({ author_id: { $in: womenIds }, ...READABLE_IN_ENGLISH_FILTER },
  { projection: { _id: 1 } }).toArray()).map((b) => String(b._id)));
const totals = { books: 0, live: 0, hidden: 0, live_readable_in_english: 0, all_readable_in_english: 0 };
for await (const b of cursor) {
  const live = b.visible === true && b.pages_count > 0;
  const readable = readableIds.has(String(b._id));
  totals.books++;
  if (live) totals.live++; else totals.hidden++;
  if (readable) totals.all_readable_in_english++;
  if (live && readable) totals.live_readable_in_english++;
  const s = byAuthor.get(b.author_id) || { books: 0, live: 0, hidden: 0, readable_live: 0 };
  s.books++; if (live) s.live++; else s.hidden++; if (live && readable) s.readable_live++;
  byAuthor.set(b.author_id, s);
}
const corpus = {
  books_with_author_id: await books.countDocuments({ author_id: { $exists: true, $ne: null } }),
  live_books: await books.countDocuments(LIVE),
  live_books_with_author_id: await books.countDocuments({ ...LIVE, author_id: { $exists: true, $ne: null } }),
};
const qidAuthorIds = withQid.map((a) => a._id);
corpus.live_books_whose_author_has_qid = await books.countDocuments({ ...LIVE, author_id: { $in: qidAuthorIds } });
await mc.close();

const rows = women.map((a) => ({
  author_id: a._id, name: a.canonical_name, wikidata_id: a.wikidata_id,
  p21: cache[a.wikidata_id].p21, ...(byAuthor.get(a._id) || { books: 0, live: 0, hidden: 0, readable_live: 0 }),
})).sort((x, y) => y.books - x.books || x.name.localeCompare(y.name));

const report = {
  measured_at: new Date().toISOString(),
  issue: 7908,
  definition: 'P21 in {Q6581072 female, Q1052281 trans woman}; books joined on books.author_id',
  authors: {
    total: authors.length,
    with_qid: withQid.length,
    without_qid: authors.length - withQid.length,
    qid_missing_on_wikidata: missing,
    qid_without_p21: noP21,
    women: women.length,
    women_with_books: rows.filter((r) => r.books > 0).length,
    women_with_live_books: rows.filter((r) => r.live > 0).length,
  },
  books: totals,
  corpus,
  women: rows,
};
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
if (MD) {
  const t = report.authors;
  const lines = [
    `# Women authors baseline (#7908) — ${report.measured_at.slice(0, 10)}`,
    '',
    `Read-only. Wikidata P21 (sex or gender) ∈ {female Q6581072, trans woman Q1052281}, fetched for every \`authors\` doc with a \`wikidata_id\`; books joined on \`books.author_id\`. Produced by \`scripts/audit/women-authors-baseline.mjs\`.`,
    '',
    '## Authors',
    '',
    `| | n |`, `|---|---:|`,
    `| authors (thesaurus) | ${t.total} |`,
    `| with a Wikidata QID | ${t.with_qid} |`,
    `| **without a QID (gender unknown — coverage limit)** | ${t.without_qid} |`,
    `| QID with no P21 statement | ${t.qid_without_p21} |`,
    `| QID missing/deleted on Wikidata | ${t.qid_missing_on_wikidata} |`,
    `| **women** | **${t.women}** |`,
    `| women with ≥1 book | ${t.women_with_books} |`,
    `| women with ≥1 live book | ${t.women_with_live_books} |`,
    '',
    '## Books by women',
    '',
    `| | n |`, `|---|---:|`,
    `| all (hidden included) | ${totals.books} |`,
    `| live (visible:true && pages_count>0) | ${totals.live} |`,
    `| hidden / not live | ${totals.hidden} |`,
    `| live and readable_in_english | ${totals.live_readable_in_english} |`,
    `| readable_in_english, hidden included | ${totals.all_readable_in_english} |`,
    '',
    `Denominators: ${corpus.live_books} live books; ${corpus.live_books_with_author_id} of them carry an author_id, and ${corpus.live_books_whose_author_has_qid} have an author with a QID — so the share of live books by women is at least ${(100 * totals.live / corpus.live_books).toFixed(2)}% of all live books and ${(100 * totals.live / corpus.live_books_whose_author_has_qid).toFixed(2)}% of those whose author is gender-resolvable.`,
    '',
    '**Coverage limit.** Books with no `author_id`, authors with no QID, and QIDs with no P21 are all *unknown*, not *not women*. Anonymous and institutional works are in that remainder by construction. Nothing was written to Mongo — no gender field (field-sprawl rule).',
    '',
    '## Women authors held (by books held)',
    '',
    '| author | QID | books | live | hidden | live & readable in English |',
    '|---|---|---:|---:|---:|---:|',
    ...rows.filter((r) => r.books > 0).map((r) => `| ${r.name.replace(/\|/g, '/')} | ${r.wikidata_id} | ${r.books} | ${r.live} | ${r.hidden} | ${r.readable_live} |`),
    '',
  ];
  writeFileSync(MD, lines.join('\n'));
}
console.log(JSON.stringify({ authors: report.authors, books: report.books, corpus }, null, 2));
