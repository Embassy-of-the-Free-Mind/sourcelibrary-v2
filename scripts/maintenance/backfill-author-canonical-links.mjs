#!/usr/bin/env node
/**
 * Backfill the canonical author link CORPUS-WIDE (GitHub #2250, Part C +
 * corpus-wide author_id). Idempotent: any book that already has `author_id` is
 * skipped, so re-runs are safe. Two phases in one pass:
 *   Phase A — entity-LESS books: link by exact author-STRING match to one person.
 *   Phase B — entity-LINKED books: map `author_entity_id` -> the authors doc that
 *             owns that entity -> set `author_id`. This is what makes the FT/ILP
 *             joins reach the whole shelf (the ~23.5K entity-linked books).
 *
 * WHAT IT WRITES (additive, reversible):
 *   - books.author_id           = <authors._id / canonical slug>   (the new canonical FK)
 *   - books.author_entity_id    = <authors.entity_ids[0]>          (Phase A only) ONLY if the
 *                                 book has none AND the canonical doc carries one (transitional;
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
 *   node scripts/maintenance/backfill-author-canonical-links.mjs            # dry run (default), LIVE books only
 *   node scripts/maintenance/backfill-author-canonical-links.mjs --apply    # write
 *   node scripts/maintenance/backfill-author-canonical-links.mjs --include-backlog          # + hidden/unprocessed
 *   node scripts/maintenance/backfill-author-canonical-links.mjs --include-backlog --apply
 *   node scripts/maintenance/backfill-author-canonical-links.mjs --undo     # revert this run's writes
 *                                       (add --include-backlog to undo the backlog run specifically)
 *
 * Env: MONGODB_URI (set -a; source .env.production.local; set +a)
 */
import { MongoClient, ObjectId } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');

/**
 * --include-backlog: also link books that are hidden or not yet processed.
 *
 * WHY THIS EXISTS. Both halves of the author layer were scoped to LIVE books —
 * this script and `build-authors-collection.mjs:71` share the filter
 * `visible: {$ne:false}, pages_count: {$gt:0}`. But imports land HIDDEN by
 * invariant (see .claude/docs/import-workflow.md), so every acquisition is born
 * outside the identity system and stays there until someone flips it visible.
 * Measured 2026-08-08: 63,568 books with an author string and no `author_id`, of
 * which 43,858 are excluded for being hidden — and `author_id` gates BOTH work
 * resolvers (`resolve-work-ids-wikidata.mjs` requires it; `llm-verify-work-
 * merges.mjs` blocks by it). So the backlog cannot acquire work identity at all,
 * which is precisely when you most want it: work_id is what answers "do we
 * already hold this?" before you import another copy.
 *
 * It stays opt-in because the two scopes answer different questions — "what does
 * the public site show" vs "what do we hold" — and the live default is the right
 * one for anything user-facing. The linking rule is unchanged and is exact:
 * verbatim NFD match to the variants of EXACTLY ONE canonical person, ambiguous
 * strings skipped, provenance written, reversible via --undo.
 */
const INCLUDE_BACKLOG = process.argv.includes('--include-backlog');
const liveScope = INCLUDE_BACKLOG ? {} : { visible: { $ne: false }, pages_count: { $gt: 0 } };
// Separate run id so a backlog pass can be reverted on its own, without also
// undoing the live linkage an earlier run wrote.
const RUN_ID = INCLUDE_BACKLOG ? 'backfill-2250-backlog' : 'backfill-2250';

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
//    Person docs by default. --include-institutions widens to is_person:false
//    docs (corporate headings — a monastery collection, a learned society):
//    the #3780 mint created those at scale, and a book whose author string IS
//    the corporate heading should link to it — the read path renders them as
//    Organization, never as a portrait-slot person (#3483). Tombstones stay out.
const INCLUDE_INSTITUTIONS = process.argv.includes('--include-institutions');
const allAuthors = await authors
  .find({
    ...(INCLUDE_INSTITUTIONS ? {} : { is_person: { $ne: false } }),
    merged_into: { $exists: false },
  }, { projection: { slug: 1, canonical_name: 1, variants: 1, entity_ids: 1, viaf_id: 1, wikidata_id: 1 } })
  .toArray();
const nameMap = new Map();
const entityToDocs = new Map(); // entity_id (string) -> [canonical docs] (for the entity-linked phase)
for (const a of allAuthors) {
  for (const v of [a.canonical_name, ...(a.variants || [])]) {
    if (!v) continue;
    const n = norm(v);
    if (!nameMap.has(n)) nameMap.set(n, []);
    if (!nameMap.get(n).some((d) => d.slug === a.slug)) nameMap.get(n).push(a);
  }
  for (const e of (a.entity_ids || [])) {
    const k = String(e);
    if (!entityToDocs.has(k)) entityToDocs.set(k, []);
    if (!entityToDocs.get(k).some((d) => d.slug === a.slug)) entityToDocs.get(k).push(a);
  }
}

// 2. Entity-LESS live books with an author string and no canonical link yet.
//    (author_id guard makes the whole script idempotent — already-linked books skipped.)
const liveUnlinked = await books
  .find(
    {
      ...liveScope,
      author: { $type: 'string', $ne: '' },
      author_id: { $exists: false },
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

// 4. Entity-LINKED live books with no canonical author_id yet — map
//    author_entity_id -> the authors doc that owns that entity -> set author_id.
//    Skipped when the entity maps to >1 is_person doc (ambiguous; left for dedup).
const liveEntityLinked = await books
  .find(
    {
      ...liveScope,
      author_entity_id: { $nin: [null, ''] },
      author_id: { $exists: false },
    },
    { projection: { id: 1, author_entity_id: 1 } },
  )
  .toArray();

let entAmbiguous = 0, entOrphan = 0;
for (const b of liveEntityLinked) {
  const ds = entityToDocs.get(String(b.author_entity_id));
  if (!ds) { entOrphan++; continue; }          // entity not owned by any canonical person
  if (ds.length > 1) { entAmbiguous++; continue; }
  const doc = ds[0];
  ops.push({
    updateOne: {
      filter: { _id: b._id },
      update: {
        $set: { author_id: doc.slug },
        $push: {
          author_link_provenance: {
            run: RUN_ID,
            method: 'entity-id-link',
            matched: b.author_entity_id,
            authors_slug: doc.slug,
            anchored: !!(doc.viaf_id || doc.wikidata_id),
            confidence: 'high', // the build already adjudicated this entity = this person
            at: stamp,
          },
        },
      },
    },
  });
}

console.log('=== backfill-author-canonical-links (#2250) ===');
console.log(`scope: ${INCLUDE_BACKLOG ? 'ALL books (live + hidden/unprocessed backlog)' : 'LIVE books only (visible && pages_count>0) — pass --include-backlog for the rest'}`);
console.log(`mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
console.log('--- Phase A: entity-less books (exact author-string match) ---');
console.log(`  scanned: ${liveUnlinked.length} | writes staged: ${ops.length - (liveEntityLinked.length - entAmbiguous - entOrphan)}`);
console.log(`    anchored=high: ${anchored} | unanchored=medium: ${unanchored} | also set author_entity_id: ${withEntityBackfill}`);
console.log(`    skipped: ambiguous ${ambiguous}, no-match ${noMatch}`);
console.log('--- Phase B: entity-linked books (author_entity_id -> authors doc) ---');
console.log(`  scanned: ${liveEntityLinked.length} | writes staged: ${liveEntityLinked.length - entAmbiguous - entOrphan}`);
console.log(`    skipped: entity owned by >1 person ${entAmbiguous}, orphan entity (no canonical owner) ${entOrphan}`);
console.log(`=> TOTAL author_id writes staged: ${ops.length}`);

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
