#!/usr/bin/env node
/**
 * author-anchor-validity.mjs — standing audit of `authors.wikidata_id`.
 *
 * Every work-identity candidate hangs off an author's Wikidata QID: the
 * resolver SPARQLs `?w wdt:P50 <anchor>` and matches titles among the results.
 * A wrong anchor therefore poisons every book under it, and does so QUIETLY —
 * if the anchor is a text rather than a person, P50 returns nothing and the run
 * prints "HIGH 0", which is indistinguishable from a clean empty result.
 *
 * Found by hand on 2026-08-08 (#3742):
 *   authors/sextus → Q1270100, the *Sentences of Sextus*, a 2nd-century
 *   collection of maxims — a TEXT used as a person. Four visible books hung
 *   off it. This audit catches that class.
 *
 * THE TEST IS A DENYLIST, NOT `P31 = Q5`, and that distinction matters here more
 * than in most corpora. The first draft of this audit demanded Q5 (human) and
 * flagged 38 anchors — including **Homer** (Q21070568, "human whose existence is
 * disputed"), **Hermes Trismegistus** (Q61002 pseudonym / Q16685255 epithet),
 * **Orpheus** (mythological Greek character), Enoch, Vyāsa, the Sibyl and
 * Chiron. Those are not errors: attributed and legendary authorship is exactly
 * what a library of Hermetica, Orphica and Vedic texts is *made of*. Gating the
 * resolver on Q5 would have silently skipped the collection's core.
 *
 * So we deny only classes that cannot be an author under any reading — a work,
 * a reference book, or a disambiguation page — and let every flavour of
 * person-like entity through.
 *
 * LIMIT, stated plainly: this checks the anchor is not a THING. It cannot check
 * it is the RIGHT person. The same session found authors/longinus → Q436634 =
 * Cassius Longinus, the Neoplatonist to whom On the Sublime was wrongly
 * ascribed — a real human, so it passes here and always will. Right-class/
 * wrong-person needs a different instrument (birth/death window vs. our books'
 * dates); deliberately out of scope rather than half-done.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/author-anchor-validity.mjs                 # audit all anchors
 *   node scripts/audit/author-anchor-validity.mjs --min-books 5   # only anchors carrying >=5 books
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { anchorProblem } from '../lib/author-anchor-classes.mjs';

const UA = 'SourceLibrary-author-anchor-audit/1.0 (https://sourcelibrary.org; team@sourcelibrary.org)';
const MIN_BOOKS = parseInt((process.argv.find(a => a.startsWith('--min-books=')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--min-books') + 1] || '0', 10) || 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db = mc.db('bookstore');

const anchors = await db.collection('authors')
  .find({ wikidata_id: { $exists: true, $ne: null } }, { projection: { _id: 1, canonical_name: 1, wikidata_id: 1 } })
  .toArray();
// how many books each anchor actually carries — severity, so the report ranks by blast radius
const counts = new Map((await db.collection('books').aggregate([
  { $match: { author_id: { $in: anchors.map(a => a._id) } } },
  { $group: { _id: '$author_id', n: { $sum: 1 } } },
]).toArray()).map(r => [r._id, r.n]));

const scope = anchors.filter(a => (counts.get(a._id) || 0) >= MIN_BOOKS);
console.log(`${anchors.length} anchors with a wikidata_id; auditing ${scope.length} (min-books=${MIN_BOOKS})`);

const qids = [...new Set(scope.map(a => String(a.wikidata_id).replace(/^wd:/, '')))];
const typeOf = new Map();
let failed = 0;
for (let i = 0; i < qids.length; i += 50) {
  const values = qids.slice(i, i + 50).map(q => `wd:${q}`).join(' ');
  const query = `SELECT ?a ?type WHERE { VALUES ?a { ${values} } OPTIONAL { ?a wdt:P31 ?type } }`;
  try {
    const r = await fetch('https://query.wikidata.org/sparql?' + new URLSearchParams({ query, format: 'json' }),
      { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error('SPARQL ' + r.status);
    const d = await r.json();
    for (const b of d.results.bindings) {
      const a = b.a.value.split('/').pop();
      const t = b.type?.value?.split('/').pop();
      if (!typeOf.has(a)) typeOf.set(a, new Set());
      if (t) typeOf.get(a).add(t);
    }
  } catch (e) {
    // Never let a transport failure read as "all clean" — record the gap.
    console.error(`  batch ${i}: ${e.message} — ${qids.slice(i, i + 50).length} anchors NOT checked`);
    failed += qids.slice(i, i + 50).length;
    for (const q of qids.slice(i, i + 50)) typeOf.set(q, null);
  }
  process.stdout.write(`\r  checked ${Math.min(i + 50, qids.length)}/${qids.length}`);
  await sleep(700);
}
console.log('');

const bad = [];
for (const a of scope) {
  const q = String(a.wikidata_id).replace(/^wd:/, '');
  const t = typeOf.get(q);
  if (t === null) continue;                       // unchecked, already reported
  const books = counts.get(a._id) || 0;
  const problem = anchorProblem(t);
  if (problem) bad.push({ ...a, books, why: problem });
}
bad.sort((x, y) => y.books - x.books);

console.log(`\n${bad.length} INVALID anchor(s)${failed ? `; ${failed} not checked (SPARQL failures — rerun)` : ''}`);
for (const b of bad) console.log(`  ${String(b.books).padStart(5)} books  ${b._id.padEnd(34)} ${String(b.wikidata_id).padEnd(11)} ${b.canonical_name?.slice(0, 26).padEnd(26)} ${b.why}`);
fs.writeFileSync('/tmp/author-anchor-validity.json', JSON.stringify({ checked: qids.length - failed, unchecked: failed, bad }, null, 2));
console.log(`\nfull -> /tmp/author-anchor-validity.json`);
if (failed) { console.error('INCOMPLETE — some anchors were never checked; this is a floor, not a clean bill.'); await mc.close(); process.exit(2); }
await mc.close();
