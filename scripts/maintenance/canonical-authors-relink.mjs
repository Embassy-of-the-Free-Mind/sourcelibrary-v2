#!/usr/bin/env node
/**
 * Targeted canonical-author relink (GitHub #2179, step 1 — non-destructive).
 *
 * Clusters distinct book-author strings into canonical people (name-order /
 * date / Latin↔vernacular variants collapse), picks ONE canonical entity per
 * cluster, and relinks that cluster's books to it (author_entity_id, written as
 * a STRING to fix the string/ObjectId split). No entity records are created or
 * deleted — relink only, so it's recoverable. Fragment cleanup is a later step.
 *
 * Canonical entity per cluster:
 *   - the cluster's books reference some entity records; pick the VIAF-anchored
 *     one. If MORE THAN ONE has VIAF → ambiguous (possible bad merge / co-
 *     authors) → SKIP the cluster. If none has VIAF → the entity with the
 *     highest book_count. If the cluster references no entity at all → SKIP
 *     (nothing to anchor to; entity creation is a later step).
 *
 * Skips placeholder "authors": Anonymous / Unknown / Various / collections.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/canonical-authors-relink.mjs            # dry-run, top 200
 *   node scripts/maintenance/canonical-authors-relink.mjs --limit 50
 *   node scripts/maintenance/canonical-authors-relink.mjs --apply --limit 200
 */
import { MongoClient, ObjectId } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 200;

const PARTICLES = new Set(['de','del','della','di','da','la','le','van','von','der','den','du','des','el','al','ibn','ben','a','ab','zu','of','the','don','fr','st','saint','y','e']);
const PLACEHOLDER = /^(anonymous|unknown|various|anon|n\/a|none|egyptian|sumerian|babylonian|assyrian|traditional)\b|collection|monastery|temple|press|library|dynasty|school of|circle of|workshop/i;
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function canonicalKey(author) {
  let s = norm(author).replace(/\([^)]*\)/g, '').replace(/,?\s*\d{3,4}\b.*$/, '').replace(/[^a-z\s,]/g, ' ');
  const toks = s.split(/[\s,]+/).filter(t => t.length >= 3 && !PARTICLES.has(t));
  const stems = toks.map(t => t
    .replace(/^j/, 'i').replace(/^gi/, 'i').replace(/v/g, 'u')
    .replace(/(issimus|us|um|orum|arum|ibus|onis|ius|is|ae|i|o|a|e)$/, ''))
    .filter(t => t.length >= 3).sort();
  return stems.join(' ');
}

const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db = mc.db('bookstore'); const books = db.collection('books'); const ents = db.collection('entities');

console.log(`canonical-author relink — ${APPLY ? 'APPLY' : 'DRY-RUN'} (top ${LIMIT} clusters)\n`);

const rows = await books.aggregate([
  { $match: { visible: { $ne: false }, pages_count: { $gt: 0 }, author: { $type: 'string', $ne: '' } } },
  { $group: { _id: '$author', n: { $sum: 1 } } },
], { allowDiskUse: true }).toArray();

const clusters = new Map();
for (const r of rows) {
  if (PLACEHOLDER.test(r._id.trim())) continue;
  const k = canonicalKey(r._id);
  if (!k) continue;
  if (!clusters.has(k)) clusters.set(k, { strings: [], books: 0 });
  const c = clusters.get(k);
  c.strings.push(r._id);
  c.books += r.n;
}
const top = [...clusters.values()].sort((a, b) => b.books - a.books).slice(0, LIMIT);

let relinked = 0, clustersDone = 0, skippedNoEntity = 0, skippedAmbiguous = 0;
const samples = [];

for (const c of top) {
  // entity ids referenced by this cluster's books
  const ids = await books.distinct('author_entity_id', { author: { $in: c.strings }, author_entity_id: { $nin: [null, ''] } });
  const idStrs = [...new Set(ids.map(String))];
  if (!idStrs.length) { skippedNoEntity++; continue; }
  const entDocs = await ents.find(
    { _id: { $in: idStrs.filter(s => ObjectId.isValid(s)).map(s => new ObjectId(s)) } },
    { projection: { name: 1, canonical_name: 1, viaf_id: 1, book_count: 1 } },
  ).toArray();
  const withViaf = entDocs.filter(e => e.viaf_id);
  let canon;
  if (withViaf.length === 1) canon = withViaf[0];
  else if (withViaf.length > 1) { skippedAmbiguous++; continue; }
  else canon = entDocs.sort((a, b) => (b.book_count || 0) - (a.book_count || 0))[0];
  if (!canon) { skippedNoEntity++; continue; }
  const canonId = String(canon._id);

  // relink all cluster books not already pointing (as a string) to canon
  const filter = { author: { $in: c.strings }, $or: [{ author_entity_id: { $ne: canonId } }, { author_entity_id: { $type: 'objectId' } }] };
  const willChange = await books.countDocuments(filter);
  clustersDone++;
  if (samples.length < 25) samples.push({ name: canon.canonical_name || canon.name, books: c.books, variants: c.strings.length, recs: idStrs.length, viaf: canon.viaf_id || '—', change: willChange });
  if (APPLY && willChange) {
    const res = await books.updateMany(filter, { $set: { author_entity_id: canonId } });
    relinked += res.modifiedCount;
  } else {
    relinked += willChange;
  }
}

console.log('Sample canonical relinks (name · books · variants · entity-recs-collapsed · VIAF · books-relinked):');
for (const s of samples) {
  console.log(`  ${String(s.books).padStart(4)}b ${String(s.variants).padStart(2)}v ${String(s.recs).padStart(2)}→1 ${s.viaf === '—' ? 'no-viaf' : 'VIAF'} +${s.change}  "${s.name}"`);
}
console.log(`\n${APPLY ? 'Relinked' : 'Would relink'} ${relinked} books across ${clustersDone} canonical authors.`);
console.log(`Skipped: ${skippedNoEntity} clusters (no entity to anchor), ${skippedAmbiguous} (multiple VIAF — needs review).`);
await mc.close();
