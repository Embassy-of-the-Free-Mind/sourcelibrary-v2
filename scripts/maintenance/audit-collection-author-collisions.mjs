#!/usr/bin/env node
/**
 * Author-identity collision guard for collections.
 *
 * Collections are often built by tagging books whose `author` STRING matches a
 * surname regex. That over-matches: a short/common surname pulls in different
 * people who happen to share the substring (three distinct "Lipsius" persons,
 * /Kant/ -> "Nilakantha", /Vair/ -> "Vairo" not "du Vair", Francis vs Roger
 * Bacon). See memory/data-quality.md "Collection tagging by author-surname
 * regex causes person-collisions (2026-07-13)".
 *
 * Two modes:
 *
 *   Preview a rule BEFORE tagging (catch collisions up front):
 *     node scripts/maintenance/audit-collection-author-collisions.mjs --rule 'Lipsius'
 *   -> lists every DISTINCT author string in the visible library the regex matches,
 *      so you can eyeball whether it is one person or several.
 *
 *   Audit an EXISTING collection's members by canonical author_id (the authors
 *   thesaurus is the identity oracle):
 *     node scripts/maintenance/audit-collection-author-collisions.mjs --collection stoicism
 *   -> groups members by resolved canonical author, reports author_id coverage,
 *      lists identity-unverified (null author_id) members, and flags singleton
 *      outliers whose canonical surname differs from their author-string surname.
 *
 * Read-only. Exits non-zero if a likely collision is flagged (usable in CI).
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/maintenance/audit-collection-author-collisions.mjs --collection <slug>
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const ruleArg = getArg('--rule');
const collectionSlug = getArg('--collection');
if (!ruleArg && !collectionSlug) {
  console.error('Provide --rule <regex> (preview) or --collection <slug> (audit).');
  process.exit(2);
}

// First alphabetic token >= 4 chars, used as a coarse "surname" signature to
// compare a book's author string against its resolved canonical name.
function surnameSig(s) {
  const toks = String(s || '').toLowerCase().replace(/[^a-zÀ-ɏ\s]/g, ' ').split(/\s+/).filter(Boolean);
  return new Set(toks.filter((t) => t.length >= 4));
}

const client = await MongoClient.connect(uri);
const db = client.db('bookstore');
const B = db.collection('books');
const A = db.collection('authors');
let flagged = 0;

if (ruleArg) {
  let re;
  try { re = new RegExp(ruleArg, 'i'); } catch (e) { console.error('Bad regex:', e.message); process.exit(2); }
  const authors = await B.distinct('author', { visible: true, pages_count: { $gt: 0 } });
  const matched = [...new Set(authors.filter((a) => a && re.test(a)))].sort();
  console.log(`Rule /${ruleArg}/i matches ${matched.length} distinct author string(s) among visible books:\n`);
  for (const a of matched) console.log(`  · ${a}`);
  if (matched.length > 1) {
    flagged = 1;
    console.log(`\n⚠  ${matched.length} distinct strings. Confirm they are the SAME person before tagging;`);
    console.log('   pair the rule with a title/work filter, or tag by author_id, if they are not.');
  } else {
    console.log('\n✓ Single distinct author string — low collision risk.');
  }
}

if (collectionSlug) {
  const books = await B.find(
    { collections: collectionSlug, visible: true },
    { projection: { _id: 0, id: 1, author: 1, author_id: 1, title: 1 } }
  ).toArray();
  if (!books.length) { console.error(`No visible books tagged '${collectionSlug}'.`); await client.close(); process.exit(2); }

  const withId = books.filter((b) => b.author_id);
  const nullId = books.filter((b) => !b.author_id);
  const ids = [...new Set(withId.map((b) => b.author_id))];
  const authorDocs = await A.find({ _id: { $in: ids } }).project({ _id: 1, canonical_name: 1 }).toArray();
  const nameOf = new Map(authorDocs.map((a) => [a._id, a.canonical_name || a._id]));

  const grp = new Map();
  for (const b of withId) {
    const nm = nameOf.get(b.author_id) || `(unresolved:${b.author_id})`;
    if (!grp.has(nm)) grp.set(nm, []);
    grp.get(nm).push(b);
  }

  console.log(`\n=== ${collectionSlug}: ${books.length} tagged | author_id ${withId.length} (${Math.round((100 * withId.length) / books.length)}%) | null ${nullId.length} ===\n`);
  console.log('Canonical authors (via author_id):');
  for (const [nm, bs] of [...grp.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(bs.length).padStart(3)}  ${nm}`);
  }

  // Singleton outliers: an author_id represented by exactly one book whose
  // author-string surname shares no token with its resolved canonical name.
  const outliers = [];
  for (const [nm, bs] of grp) {
    if (bs.length !== 1 || nm.startsWith('(unresolved')) continue;
    const canonSig = surnameSig(nm);
    const strSig = surnameSig(bs[0].author);
    const overlap = [...canonSig].some((t) => strSig.has(t));
    if (!overlap) outliers.push({ nm, b: bs[0] });
  }
  if (outliers.length) {
    flagged = 1;
    console.log(`\n⚠  ${outliers.length} singleton outlier(s) — canonical name shares no surname token with the author string (review for mis-tag):`);
    for (const o of outliers) console.log(`     "${o.b.author}"  ->  author_id=${o.nm}  |  ${String(o.b.title).slice(0, 45)}`);
  }
  if (nullId.length) {
    console.log(`\n${nullId.length} identity-unverified member(s) (no author_id) — confirm the person by hand:`);
    for (const b of nullId) console.log(`     ${String(b.author || '?').slice(0, 32).padEnd(32)} | ${String(b.title).slice(0, 45)}`);
  }
  if (!outliers.length) console.log('\n✓ No author_id-level collisions detected.');
}

await client.close();
process.exit(flagged ? 1 : 0);
