#!/usr/bin/env node
/**
 * Stage 1+2 of #3780 — enumerate the author strings the thesaurus cannot see,
 * keyed by STRING (the author-identity invariant: a doc-keyed sweep silently
 * misses strings that never joined), and pre-classify them.
 *
 * READ-ONLY. Emits scripts/output/unmatched-author-strings-3780.json with one
 * row per author string carrying >= --min-books books (default 5) that matches
 * (NFD-normalized, verbatim) no variant of any canonical author doc:
 *   { string, books, bucket, sample: {title, year, language, provider} }
 *
 * Buckets (heuristic, for human/agent review — nothing is minted from here):
 *   placeholder   — Unknown/Anonymous/S.n./ethnonyms; must NEVER get a doc
 *   defect        — [object Object]-class artifacts; route to the defect issue
 *   institution   — monasteries, libraries, presses; person docs would tell
 *                   search engines a monastery is a human (#3483)
 *   ambiguous     — matches variants of MORE than one canonical doc (the
 *                   backfill rightly skips these; listed for visibility)
 *   cjk           — CJK personal-name candidates (855 strings, 12.6K books
 *                   measured in #3780) — real author docs, non-Latin pipeline
 *   person?       — everything else; the additive-minting candidates
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/analysis/enumerate-unmatched-author-strings.mjs
 *   node --env-file=.env.production.local scripts/analysis/enumerate-unmatched-author-strings.mjs --min-books 3
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';

const MIN_BOOKS = parseInt((process.argv.find(a => a.startsWith('--min-books=')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--min-books') + 1] || '5', 10) || 5;

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Same spirit as build-authors-collection's PLACEHOLDER, split into the two
// buckets that need different handling (placeholders get nothing; institutions
// get is_person:false docs, eventually).
const PLACEHOLDER_RX = /^(anonymous|unknown|various|anon\.?|n\/a|none|s\.?n\.?|sine nomine|traditional)\b|^(anonymous )?(egyptian|sumerian|babylonian|assyrian|chinese|japanese|tibetan|greek|roman|hebrew|arabic)$/i;
const DEFECT_RX = /\[object|^undefined$|^null$|^\d+$|^[\s\-–—.,;:]+$/i;
const INSTITUTION_RX = /collection$|\b(monastery|temple|library|museum|archive|press|dynasty|church|council|society|congregation|order of|company|guild|academy|universit|conserv|ministry|commission|office|bureau|institut|verlag|drukkerij|imprimerie|typographia|bibliothe|seminar|convent|abbey|school)\b|^(school|circle|workshop|followers?) of\b/i;
const CJK_RX = /[⺀-⻿　-〿㇀-㇯㈀-鿿豈-﫿]/;

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');

// canonical variant map: norm(variant) -> count of docs claiming it
const variantDocs = new Map();
for await (const a of db.collection('authors').find({}, { projection: { variants: 1, canonical_name: 1, merged_into: 1 } })) {
  if (a.merged_into) continue;
  for (const v of new Set([...(a.variants || []), a.canonical_name].filter(Boolean).map(norm))) {
    variantDocs.set(v, (variantDocs.get(v) || 0) + 1);
  }
}
console.log(`canonical docs loaded; ${variantDocs.size} distinct normalized variants`);

// group ALL books (live + backlog) with an author string and no author_id
const rows = await db.collection('books').aggregate([
  // Artwork records are a different population — artists route to /artwork/
  // surfaces, the identity worker excludes them, and the thesaurus is a BOOK
  // author layer. Without this the person? bucket is dominated by Raphael and
  // Rembrandt print records.
  { $match: {
      author: { $type: 'string', $nin: ['', null] }, author_id: { $in: [null, undefined] },
      content_type: { $ne: 'artwork' }, resource_type: { $exists: false },
  } },
  { $group: {
      _id: '$author',
      books: { $sum: 1 },
      sample: { $first: { title: '$title', year: '$year', language: '$language', provider: '$image_source.provider', visible: '$visible' } },
  } },
  { $match: { books: { $gte: MIN_BOOKS } } },
  { $sort: { books: -1 } },
], { allowDiskUse: true }).toArray();

const out = [];
const bucketCounts = {};
let coveredBooks = 0;
for (const r of rows) {
  const n = norm(r._id);
  const claims = variantDocs.get(n) || 0;
  if (claims === 1) continue;                 // matched: the backfill handles it
  const bucket =
    claims > 1 ? 'ambiguous'
    : DEFECT_RX.test(r._id) ? 'defect'
    : PLACEHOLDER_RX.test(r._id) ? 'placeholder'
    : INSTITUTION_RX.test(r._id) ? 'institution'
    : CJK_RX.test(r._id) ? 'cjk'
    : 'person?';
  bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1;
  coveredBooks += r.books;
  out.push({ string: r._id, books: r.books, bucket, sample: r.sample });
}

console.log(`\n${out.length} unmatched strings with >=${MIN_BOOKS} books, covering ${coveredBooks} books`);
for (const [b, c] of Object.entries(bucketCounts).sort((x, y) => y[1] - x[1])) {
  const books = out.filter(o => o.bucket === b).reduce((s, o) => s + o.books, 0);
  console.log(`  ${b.padEnd(12)} ${String(c).padStart(6)} strings  ${String(books).padStart(7)} books`);
}
console.log('\nTop 20 per bucket:');
for (const b of Object.keys(bucketCounts)) {
  console.log(`\n── ${b} ──`);
  for (const o of out.filter(x => x.bucket === b).slice(0, 20)) {
    console.log(`  ${String(o.books).padStart(5)}  ${o.string.slice(0, 44).padEnd(46)} ${(o.sample.title || '').slice(0, 50)}`);
  }
}

mkdirSync('scripts/output', { recursive: true });
const path = 'scripts/output/unmatched-author-strings-3780.json';
writeFileSync(path, JSON.stringify({ generated_at: new Date().toISOString(), min_books: MIN_BOOKS, strings: out.length, covered_books: coveredBooks, buckets: bucketCounts, rows: out }, null, 2));
console.log(`\nfull -> ${path}`);
await mc.close();
