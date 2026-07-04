#!/usr/bin/env node
/**
 * Build the `canonical_entities` read model (GitHub #2979).
 *
 * The `entities` collection is ~1M docs (~1.9GB): per-book mention extraction
 * output (one doc per (name, type), with an embedded books[] array), of which
 * only a ~28K sliver carries Wikidata enrichment (wikidata_id / dates /
 * coordinates / description). Every public explore surface — /explore,
 * /explore/timeline, /api/explore/map — queries ONLY that sliver, but pays for
 * the full 1M collection (the 2026-07-04 timeline outage, #2973; partial
 * indexes patched the hot paths but growth keeps eroding the margin).
 *
 * This materializes the enriched sliver into a small, fully-indexed
 * `canonical_entities` collection — one doc per Wikidata QID (duplicate rows
 * merged; enriched rows without a QID keyed by their entities._id so timeline/
 * map parity is exact). It also rolls up per-entity book language counts (so
 * the timeline's second query — languages for ~14K book ids — can disappear
 * from the read path) and writes whole-collection stats to
 * `system_config.entity_stats` (so /explore's hub counts stop scanning 1M
 * rows).
 *
 * READ MODEL, NOT TRUTH (same contract as the Supabase catalog / homepage
 * stats):
 *   - Source of truth stays `entities` (mention graph + enrichment writers:
 *     enrich-worker syncBookEntities, wikidata-align, /api/cron/enrich-entities,
 *     author-authority.ts) and `authors` (person identity, #2179).
 *   - This collection is derived and droppable; the build is deterministic
 *     and idempotent (staging collection + atomic rename, so readers never
 *     see a partial build).
 *   - Staleness bound: <= 24h (nightly cron, 03:45 UTC — after the 02:15
 *     Vercel enrich-entities cron and the 03:30 Supabase entity sync).
 *
 * Person docs carry `author_slug` -> `authors._id` when the person is also a
 * book author (joined via shared wikidata_id or authors.entity_ids), so this
 * never becomes a third person identity store: identity questions stay with
 * `authors`; this is presentation data for explore surfaces.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/build-canonical-entities.mjs            # dry-run (no writes)
 *   node scripts/maintenance/build-canonical-entities.mjs --apply    # build + swap
 *
 * Nightly (Hetzner crontab — see scripts/workers/crontab.production):
 *   45 3 * * * ... flock -n /tmp/sl-canonical-entities.lock ... --apply
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
/** --skip-stats: build/swap the collection but do NOT touch system_config
 *  (used for trial builds where only the new collection may be written). */
const SKIP_STATS = process.argv.includes('--skip-stats');
const COLLECTION = 'canonical_entities';
const STAGING = `${COLLECTION}_next`;
/** Cap stored book_ids per entity (most-mentioned first). book_count stays exact. */
const BOOK_IDS_CAP = 500;

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const mc = new MongoClient(uri);
await mc.connect();
const db = mc.db('bookstore');
const ents = db.collection('entities');

const t0 = Date.now();
console.log(`build canonical_entities — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

// ── 1. Pull the enriched sliver (partial-indexed fields only; never a full scan).
// Union of the four enrichment predicates so timeline (dates), map (coords) and
// hub/encyclopedia (wikidata_id) all see exactly the rows they see today.
const SLIVER_FIELDS = ['wikidata_id', 'wikidata_birth_date', 'wikidata_death_date', 'wikidata_coordinates'];
// Ship per-book PAGE COUNTS, not the raw pages arrays — popular concepts carry
// thousands of books each with page-number lists; projecting `books.pages`
// verbatim moves GBs over the wire (measured: the naive find() ran >5 min at
// ~900MB RSS; this $map/$size shape finishes in seconds per pass).
const shapeStage = {
  $project: {
    name: 1, canonical_name: 1, type: 1, aliases: 1, description: 1,
    wikidata_id: 1, wikidata_birth_date: 1, wikidata_death_date: 1,
    wikidata_coordinates: 1, birth_place: 1, death_place: 1,
    portrait_url: 1, wikipedia_url: 1, viaf_id: 1, gnd_id: 1, lcnaf_id: 1,
    book_count: 1, total_mentions: 1,
    books: {
      $map: {
        input: { $ifNull: ['$books', []] },
        as: 'b',
        in: { book_id: '$$b.book_id', mentions: { $size: { $ifNull: ['$$b.pages', []] } } },
      },
    },
  },
};
const rowsById = new Map();
for (const field of SLIVER_FIELDS) {
  // one indexed pass per partial index (a single $or can't use them all)
  const cursor = ents.aggregate(
    [{ $match: { [field]: { $exists: true, $ne: null } } }, shapeStage],
    { maxTimeMS: 300000, allowDiskUse: true },
  );
  for await (const doc of cursor) rowsById.set(String(doc._id), doc);
}
const rows = [...rowsById.values()];
console.log(`enriched sliver: ${rows.length} entity rows (of ~${await ents.estimatedDocumentCount()} total)`);

// ── 2. Group by QID (merge duplicate rows); non-QID enriched rows keyed by _id.
const groups = new Map();
for (const r of rows) {
  const key = r.wikidata_id || `e:${String(r._id)}`;
  (groups.get(key) || groups.set(key, []).get(key)).push(r);
}

// ── 3. authors join: QID -> slug and legacy entity_id -> slug (persons only).
const authorDocs = await db.collection('authors')
  .find({}, { projection: { slug: 1, wikidata_id: 1, entity_ids: 1 } })
  .toArray();
const slugByQid = new Map();
const slugByEntityId = new Map();
for (const a of authorDocs) {
  const slug = a.slug || a._id;
  if (a.wikidata_id && !slugByQid.has(a.wikidata_id)) slugByQid.set(a.wikidata_id, slug);
  for (const id of a.entity_ids || []) if (!slugByEntityId.has(String(id))) slugByEntityId.set(String(id), slug);
}
console.log(`authors thesaurus: ${authorDocs.length} docs (${slugByQid.size} QIDs, ${slugByEntityId.size} legacy entity links)`);

// ── 4. book id -> language map (covered by books.id_language_covered, #2973).
const allBookIds = new Set();
for (const r of rows) for (const b of r.books || []) if (b.book_id) allBookIds.add(b.book_id);
const langByBook = new Map();
const bookIdArr = [...allBookIds];
for (let i = 0; i < bookIdArr.length; i += 5000) {
  const docs = await db.collection('books').find(
    { id: { $in: bookIdArr.slice(i, i + 5000) } },
    { projection: { _id: 0, id: 1, language: 1 }, maxTimeMS: 120000 },
  ).toArray();
  for (const d of docs) if (d.language) langByBook.set(d.id, d.language);
}
console.log(`book language map: ${langByBook.size}/${allBookIds.size} referenced book ids resolved`);

// ── 5. Assemble one doc per canonical entity.
const typeRank = { person: 3, place: 2, concept: 1 };
const docs = [];
for (const [key, members] of groups) {
  // primary row: most-mentioned (stable tiebreak on _id so rebuilds are deterministic)
  members.sort((a, b) => (b.book_count || 0) - (a.book_count || 0) || String(a._id).localeCompare(String(b._id)));
  const primary = members[0];
  const types = [...new Set(members.map(m => m.type).filter(Boolean))]
    .sort((a, b) => (typeRank[b] || 0) - (typeRank[a] || 0));
  const type = types[0] || 'concept';

  // union book mentions across merged rows
  const mentionsByBook = new Map();
  for (const m of members) {
    for (const b of m.books || []) {
      if (!b.book_id) continue;
      mentionsByBook.set(b.book_id, (mentionsByBook.get(b.book_id) || 0) + (b.mentions || 1));
    }
  }
  const rankedBooks = [...mentionsByBook.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const languages = {};
  for (const [bookId] of rankedBooks) {
    const lang = langByBook.get(bookId);
    if (lang) languages[lang] = (languages[lang] || 0) + 1;
  }

  const pick = (field) => members.map(m => m[field]).find(v => v != null) ?? null;
  const wikidataId = primary.wikidata_id || null;
  const authorSlug = type === 'person'
    ? (wikidataId && slugByQid.get(wikidataId))
      || members.map(m => slugByEntityId.get(String(m._id))).find(Boolean)
      || null
    : null;

  docs.push({
    _id: key,                              // QID, or `e:<entities._id>` for non-QID enriched rows
    wikidata_id: wikidataId,
    name: primary.canonical_name || primary.name,
    display_name: primary.canonical_name || primary.name,
    raw_names: [...new Set(members.flatMap(m => [m.name, m.canonical_name]).filter(Boolean))],
    aliases: [...new Set(members.flatMap(m => m.aliases || []))].slice(0, 50),
    type,
    types,
    description: pick('description'),
    wikidata_birth_date: pick('wikidata_birth_date'),
    wikidata_death_date: pick('wikidata_death_date'),
    wikidata_coordinates: pick('wikidata_coordinates'),
    birth_place: pick('birth_place'),
    death_place: pick('death_place'),
    portrait_url: pick('portrait_url'),
    wikipedia_url: pick('wikipedia_url'),
    viaf_id: pick('viaf_id'),
    gnd_id: pick('gnd_id'),
    lcnaf_id: pick('lcnaf_id'),
    author_slug: authorSlug,               // -> authors._id; identity lives THERE (#2179)
    book_count: mentionsByBook.size,       // exact, unioned across merged rows
    total_mentions: [...mentionsByBook.values()].reduce((s, n) => s + n, 0),
    book_ids: rankedBooks.slice(0, BOOK_IDS_CAP).map(([id]) => id),
    languages,                             // { la: 12, de: 3, ... } — timeline tradition rollup
    entity_ids: members.map(m => String(m._id)),  // provenance: source rows merged
    source: 'build-canonical-entities',
    built_at: new Date(),
  });
}
docs.sort((a, b) => b.book_count - a.book_count);

const byType = {};
for (const d of docs) byType[d.type] = (byType[d.type] || 0) + 1;
const withDates = docs.filter(d => d.wikidata_birth_date || d.wikidata_death_date).length;
const withCoords = docs.filter(d => d.wikidata_coordinates).length;
const withAuthor = docs.filter(d => d.author_slug).length;
const merged = docs.filter(d => d.entity_ids.length > 1).length;
console.log(`\ncanonical entities: ${docs.length} (from ${rows.length} rows; ${merged} QIDs merged >1 row)`);
console.log(`  by type: ${JSON.stringify(byType)}`);
console.log(`  with dates: ${withDates}  with coordinates: ${withCoords}  persons linked to authors: ${withAuthor}`);

// ── 6. Whole-collection stats for the /explore hub (replaces its 1M-row counts).
const statTypes = await ents.aggregate(
  [{ $group: { _id: '$type', n: { $sum: 1 } } }],
  { maxTimeMS: 300000, allowDiskUse: true },
).toArray();
const entityStats = {
  total: statTypes.reduce((s, t) => s + t.n, 0),
  by_type: Object.fromEntries(statTypes.map(t => [t._id || 'unknown', t.n])),
  canonical: docs.length,
  canonical_by_type: byType,
  with_dates: withDates,
  with_coordinates: withCoords,
  with_wikidata_id: docs.filter(d => d.wikidata_id).length,
  updatedAt: new Date(),
};
console.log(`\nentity_stats: total ${entityStats.total}  by_type ${JSON.stringify(entityStats.by_type)}`);

if (!APPLY) {
  console.log(`\nDRY-RUN — no writes (${((Date.now() - t0) / 1000).toFixed(1)}s). Re-run with --apply to build ${COLLECTION}.`);
  await mc.close();
  process.exit(0);
}

// ── 7. Write to a staging collection, index it, then atomically swap in.
await db.collection(STAGING).drop().catch(() => {});
for (let i = 0; i < docs.length; i += 1000) {
  await db.collection(STAGING).insertMany(docs.slice(i, i + 1000), { ordered: false });
}
await db.collection(STAGING).createIndex({ type: 1, book_count: -1 });
await db.collection(STAGING).createIndex({ wikidata_id: 1 }, { sparse: true });
await db.collection(STAGING).createIndex({ wikidata_birth_date: 1 }, { sparse: true });
await db.collection(STAGING).createIndex({ wikidata_death_date: 1 }, { sparse: true });
await db.collection(STAGING).createIndex({ wikidata_coordinates: 1 }, { sparse: true });
await db.collection(STAGING).createIndex({ author_slug: 1 }, { sparse: true });
await db.collection(STAGING).createIndex({ name: 1 });
await db.collection(STAGING).createIndex({ book_ids: 1 });
// atomic swap — readers never see a partial build
await db.admin().command({
  renameCollection: `bookstore.${STAGING}`,
  to: `bookstore.${COLLECTION}`,
  dropTarget: true,
});
if (SKIP_STATS) {
  console.log('\n--skip-stats: system_config.entity_stats NOT written.');
} else {
  await db.collection('system_config').updateOne(
    { _id: 'entity_stats' },
    { $set: entityStats },
    { upsert: true },
  );
}
console.log(`\nWrote ${docs.length} docs to ${COLLECTION} (+8 indexes, atomic swap)${SKIP_STATS ? '' : ' and system_config.entity_stats'} in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
console.log(`Derived + droppable: db.${COLLECTION}.drop() is always safe; source of truth is entities + authors.`);
await mc.close();
