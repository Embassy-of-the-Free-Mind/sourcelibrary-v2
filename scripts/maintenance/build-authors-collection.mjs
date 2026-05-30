#!/usr/bin/env node
/**
 * Build the clean canonical `authors` collection (GitHub #2179, step 1).
 *
 * The `entities` collection conflates ~305K mentioned people (mention-extraction
 * debris) with the few thousand actual BOOK authors, fragmenting one person
 * across many records. This builds a separate, clean author layer scoped to
 * book authors only — one document per person — WITHOUT touching `entities`,
 * `books`, or any read path. It is purely additive and fully reversible
 * (`db.authors.drop()`); migrating reads onto it and retiring `entities` are
 * later, reviewed steps.
 *
 * Clustering = canonical name key (Latin↔vernacular / name-order / date variants
 * collapse; non-Latin scripts keyed on the folded raw name) UNIONED with shared
 * harvested authority ids (VIAF / Wikidata) so e.g. Erasmus/Desiderius/
 * Roterodamus merge when they share a VIAF even if the name key differs.
 *
 * Each author doc (provenance kept so the build is auditable / reversible):
 *   { _id: <slug>, canonical_name, slug, variants[], variant_slugs[],
 *     book_count, viaf_id, wikidata_id, entity_ids[], source, built_at }
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/build-authors-collection.mjs            # dry-run (no writes)
 *   node scripts/maintenance/build-authors-collection.mjs --apply    # writes `authors`
 */
import { MongoClient, ObjectId } from 'mongodb';

const APPLY = process.argv.includes('--apply');

const PARTICLES = new Set(['de','del','della','di','da','la','le','van','von','der','den','du','des','el','al','ibn','ben','a','ab','zu','of','the','don','fr','st','saint','y','e','pseudo']);
// People-only: drop placeholders, institutions, and ethnonym/anonymous buckets.
const PLACEHOLDER = /^(anonymous|unknown|various|anon|n\/a|none|egyptian|sumerian|babylonian|assyrian|traditional|chinese|japanese|tibetan|greek|roman)\b|collection|monastery|temple|press|library|dynasty|school of|circle of|workshop|^mtena|\b(church|council|society|congregation|order of|company of|guild|academy|université|university|conserv|ministry|commission|office|bureau)\b/i;
/** Compound authorship ("A & B", "A; B", "A and B" with two names) — real co-
 *  authored works, but not one person, so they don't become a canonical author. */
const COMPOUND = /\s(&|;|\band\b)\s.*[a-z]/i;

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Cluster key: folded Latin stems of the name tokens; non-Latin names fall back
 *  to the diacritic-folded raw name so CJK/Cyrillic/Greek authors still cluster. */
function canonicalKey(author) {
  const s = norm(author).replace(/\([^)]*\)/g, '').replace(/,?\s*\d{3,4}\b.*$/, '').replace(/[^a-z\s,]/g, ' ');
  const toks = s.split(/[\s,]+/).filter(t => t.length >= 3 && !PARTICLES.has(t));
  const stems = toks.map(t => t
    .replace(/^j/, 'i').replace(/^gi/, 'i').replace(/v/g, 'u')
    .replace(/(issimus|us|um|orum|arum|ibus|onis|ius|is|ae|i|o|a|e)$/, ''))
    .filter(t => t.length >= 3).sort();
  if (!stems.length) {
    return (author || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/\([^)]*\)/g, '').replace(/[\d,.;]/g, '').replace(/\s+/g, '').toLowerCase();
  }
  return stems.join(' ');
}

/** URL slug — must match src/lib/slugify.ts authorSlug() exactly. */
const authorSlug = (a) => (a || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');

const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db = mc.db('bookstore'); const books = db.collection('books'); const ents = db.collection('entities');

console.log(`build authors collection — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

// 1. distinct book-author strings over live books, with book counts + linked entities
const rows = await books.aggregate([
  { $match: { visible: { $ne: false }, pages_count: { $gt: 0 }, author: { $type: 'string', $ne: '' } } },
  { $group: { _id: '$author', n: { $sum: 1 }, ents: { $addToSet: '$author_entity_id' } } },
], { allowDiskUse: true }).toArray();
const compound = rows.filter(r => !PLACEHOLDER.test(r._id.trim()) && COMPOUND.test(r._id));
const authors = rows.filter(r => !PLACEHOLDER.test(r._id.trim()) && !COMPOUND.test(r._id));
console.log(`distinct live author strings: ${rows.length}  (people: ${authors.length}, compound/co-author strings held back: ${compound.length}, placeholders/institutions: ${rows.length - authors.length - compound.length})`);

// 2. harvest viaf / wikidata / canonical_name from the linked entity records
const allIds = [...new Set(authors.flatMap(r => r.ents).filter(Boolean).map(String))];
const objIds = allIds.filter(s => ObjectId.isValid(s)).map(s => new ObjectId(s));
const em = new Map();
for (let i = 0; i < objIds.length; i += 2000) {
  const docs = await ents.find({ _id: { $in: objIds.slice(i, i + 2000) } },
    { projection: { viaf_id: 1, wikidata_id: 1, canonical_name: 1, name: 1, book_count: 1 } }).toArray();
  for (const e of docs) em.set(String(e._id), e);
}
for (const r of authors) {
  r.viaf = null; r.wd = null; r.entName = null; r.entBooks = 0; r.entIds = [];
  for (const id of r.ents) {
    if (!id) continue;
    const e = em.get(String(id)); if (!e) continue;
    r.entIds.push(String(id));
    if (e.viaf_id && !r.viaf) { r.viaf = e.viaf_id; r.entName = e.canonical_name || e.name; }
    if (e.wikidata_id && !r.wd) r.wd = e.wikidata_id;
    if ((e.book_count || 0) >= r.entBooks) { r.entBooks = e.book_count || 0; if (!r.entName) r.entName = e.canonical_name || e.name; }
  }
  r.key = canonicalKey(r._id);
}

// 3. union-find: merge on canonical key, then on shared VIAF, then shared Wikidata
const parent = authors.map((_, i) => i);
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
const groupBy = (keyFn) => { const m = new Map(); authors.forEach((r, i) => { const k = keyFn(r); if (!k) return; (m.get(k) || m.set(k, []).get(k)).push(i); }); return m; };
for (const fn of [r => r.key, r => r.viaf, r => r.wd]) {
  for (const g of groupBy(fn).values()) for (let j = 1; j < g.length; j++) union(g[0], g[j]);
}

// 4. assemble one author doc per cluster
const clusters = new Map();
authors.forEach((r, i) => { const root = find(i); (clusters.get(root) || clusters.set(root, []).get(root)).push(r); });

const docs = [];
const slugCounts = new Map();
for (const members of clusters.values()) {
  members.sort((a, b) => b.n - a.n);
  const viaf = members.find(m => m.viaf)?.viaf || null;
  const wd = members.find(m => m.wd)?.wd || null;
  // canonical name: prefer a harvested entity canonical_name (clean, natural order); else the most-common variant
  const canonical_name = members.find(m => m.viaf && m.entName)?.entName || members.find(m => m.entName)?.entName || members[0]._id;
  let slug = authorSlug(canonical_name);
  if (!slug) continue;
  const seen = slugCounts.get(slug) || 0; slugCounts.set(slug, seen + 1);
  if (seen > 0) slug = `${slug}-${seen + 1}`;            // disambiguate slug collisions across different people
  const variants = [...new Set(members.map(m => m._id))];
  docs.push({
    _id: slug,
    canonical_name,
    slug,
    variants,
    variant_slugs: [...new Set(variants.map(authorSlug).filter(Boolean))],
    book_count: members.reduce((s, m) => s + m.n, 0),
    viaf_id: viaf,
    wikidata_id: wd,
    entity_ids: [...new Set(members.flatMap(m => m.entIds))],
    source: 'build-authors-collection',
    built_at: new Date(),
  });
}
docs.sort((a, b) => b.book_count - a.book_count);

console.log(`\nclusters → ${docs.length} canonical authors`);
console.log(`  with VIAF: ${docs.filter(d => d.viaf_id).length}  with Wikidata: ${docs.filter(d => d.wikidata_id).length}  multi-variant: ${docs.filter(d => d.variants.length > 1).length}`);
console.log('\nTop 15 by book_count (name · books · variants · viaf):');
for (const d of docs.slice(0, 15)) console.log(`  ${String(d.book_count).padStart(4)}b ${String(d.variants.length).padStart(2)}v ${d.viaf_id ? 'VIAF' : 'no-viaf'}  "${d.canonical_name}"  [${d.slug}]`);

// fragmentation sanity — each famous person should be exactly ONE doc
const oneDoc = (re) => docs.filter(d => d.variants.some(v => re.test(v))).length;
console.log('\nFragmentation sanity (should be 1 each):');
for (const [nm, re] of [['Spinoza', /spinoza/i], ['Bruno', /giordano bruno|bruno, giordano/i], ['Erasmus', /erasmus|roterodam/i], ['Paracelsus', /paracelsus/i], ['Aquinas', /aquinas|aquino/i], ['Descartes', /descartes/i]])
  console.log(`  ${nm.padEnd(12)} → ${oneDoc(re)} doc(s)`);

if (APPLY) {
  await db.collection('authors').drop().catch(() => {});
  // chunked insert
  for (let i = 0; i < docs.length; i += 1000) await db.collection('authors').insertMany(docs.slice(i, i + 1000), { ordered: false });
  await db.collection('authors').createIndex({ slug: 1 }, { unique: true });
  await db.collection('authors').createIndex({ variant_slugs: 1 });
  await db.collection('authors').createIndex({ viaf_id: 1 }, { sparse: true });
  await db.collection('authors').createIndex({ book_count: -1 });
  console.log(`\nWrote ${docs.length} docs to authors (+ indexes). Reversible: db.authors.drop()`);
} else {
  console.log(`\nDRY-RUN — no writes. Re-run with --apply to create the authors collection.`);
}
await mc.close();
