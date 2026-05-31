#!/usr/bin/env node
/**
 * Backfill the canonical author link onto entity-less books (GitHub #2250,
 * Part C — finish linking the unlinked tail).
 *
 * WHAT IT WRITES (additive, reversible):
 *   - books.author_id           = <authors._id / canonical slug>   (the new canonical FK)
 *   - books.author_entity_id    = <authors.entity_ids[0]>          ONLY if the book has
 *                                 none AND the canonical doc carries one (transitional;
 *                                 `entities` is the retiring layer)
 *   - books.author_link_provenance[] += one assertion record (who/how/when/confidence)
 *
 * SAFETY — why this is not a risky merge:
 *   We only link a book when its author STRING is verbatim (NFD-normalized) one of
 *   the `variants[]` of EXACTLY ONE canonical person. This is exact self-linkage,
 *   not fuzzy guessing. Strings that map to >1 canonical doc are SKIPPED
 *   (under-merge over mis-merge — the #2218 stance). Every write carries provenance
 *   so it is fully auditable and reversible via `--undo`.
 *
 * USAGE:
 *   node scripts/maintenance/backfill-author-canonical-links.mjs            # dry run (default)
 *   node scripts/maintenance/backfill-author-canonical-links.mjs --apply    # write
 *   node scripts/maintenance/backfill-author-canonical-links.mjs --undo     # revert this run's writes
 *
 * Env: MONGODB_URI (set -a; source .env.production.local; set +a)
 */
import { MongoClient, ObjectId } from 'mongodb';

const RUN_ID = 'backfill-2250';
const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const authors = db.collection('authors');

if (UNDO) {
  // Reverse exactly this run: unset author_id where its provenance came from RUN_ID,
  // and pull our provenance records. (author_entity_id we backfilled is left in place —
  // it's a legitimate value; re-running with --apply is idempotent anyway.)
  const filter = { 'author_link_provenance.run': RUN_ID };
  const n = await books.countDocuments(filter);
  console.log(`[undo] ${n} books carry a ${RUN_ID} provenance record.`);
  if (APPLY) {
    const r = await books.updateMany(filter, {
      $unset: { author_id: '' },
      $pull: { author_link_provenance: { run: RUN_ID } },
    });
    console.log(`[undo] modified ${r.modifiedCount}.`);
  } else {
    console.log('[undo] dry run — pass --apply with --undo to execute.');
  }
  await mc.close();
  process.exit(0);
}

// 1. Build NFD-normalized name -> [canonical docs] multimap from the thesaurus.
const allAuthors = await authors
  .find({ is_person: { $ne: false } }, { projection: { slug: 1, canonical_name: 1, variants: 1, entity_ids: 1, viaf_id: 1, wikidata_id: 1 } })
  .toArray();
const nameMap = new Map();
for (const a of allAuthors) {
  for (const v of [a.canonical_name, ...(a.variants || [])]) {
    if (!v) continue;
    const n = norm(v);
    if (!nameMap.has(n)) nameMap.set(n, []);
    if (!nameMap.get(n).some((d) => d.slug === a.slug)) nameMap.get(n).push(a);
  }
}

// 2. Entity-less live books with an author string.
const liveUnlinked = await books
  .find(
    {
      visible: { $ne: false },
      pages_count: { $gt: 0 },
      author: { $type: 'string', $ne: '' },
      $or: [{ author_entity_id: { $in: [null, ''] } }, { author_entity_id: { $exists: false } }],
    },
    { projection: { id: 1, author: 1, author_entity_id: 1 } },
  )
  .toArray();

// 3. Stage writes for unique exact-string matches.
const stamp = new Date().toISOString();
const ops = [];
let ambiguous = 0, noMatch = 0, anchored = 0, unanchored = 0, withEntityBackfill = 0;
for (const b of liveUnlinked) {
  const ds = nameMap.get(norm(b.author));
  if (!ds) { noMatch++; continue; }
  if (ds.length > 1) { ambiguous++; continue; }
  const doc = ds[0];
  const isAnchored = !!(doc.viaf_id || doc.wikidata_id);
  isAnchored ? anchored++ : unanchored++;

  const set = { author_id: doc.slug };
  const entityId = (doc.entity_ids || []).find((id) => ObjectId.isValid(id));
  const needsEntity = entityId && !b.author_entity_id;
  if (needsEntity) { set.author_entity_id = entityId; withEntityBackfill++; }

  ops.push({
    updateOne: {
      filter: { _id: b._id },
      update: {
        $set: set,
        $push: {
          author_link_provenance: {
            run: RUN_ID,
            method: 'exact-string-match',
            matched: b.author,
            authors_slug: doc.slug,
            anchored: isAnchored,
            confidence: isAnchored ? 'high' : 'medium',
            at: stamp,
          },
        },
      },
    },
  });
}

console.log('=== backfill-author-canonical-links (#2250) ===');
console.log(`mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
console.log(`entity-less live books scanned: ${liveUnlinked.length}`);
console.log(`  -> unique-match writes staged: ${ops.length}`);
console.log(`       anchored (confidence=high): ${anchored} | unanchored (confidence=medium): ${unanchored}`);
console.log(`       of which also backfill author_entity_id: ${withEntityBackfill}`);
console.log(`  -> skipped ambiguous (>1 person): ${ambiguous}`);
console.log(`  -> skipped no canonical match (tail/placeholder): ${noMatch}`);

if (APPLY && ops.length) {
  // Index for the read-path author_id lookup (idempotent).
  await books.createIndex({ author_id: 1 }, { name: 'author_id_1' });
  let modified = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const r = await books.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    modified += r.modifiedCount;
  }
  console.log(`\nAPPLIED: modifiedCount = ${modified} / ${ops.length} staged.`);
} else if (!APPLY) {
  console.log('\nDry run — pass --apply to write. Reversible via --undo --apply.');
}

await mc.close();
