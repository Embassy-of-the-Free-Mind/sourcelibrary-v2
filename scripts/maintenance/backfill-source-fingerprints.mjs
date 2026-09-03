#!/usr/bin/env node
/**
 * Backfill `source_fingerprints` (the tier-1 SET) on `books` and `books_warehouse`.
 *
 * ADDITIVE ONLY. This sweep `$set`s one new array field and nothing else. It
 * never `$unset`s, never deletes, never touches `visible`/`hidden`, never
 * writes `duplicate_of`, and never modifies the legacy scalar
 * `source_fingerprint` — indexes, the warehouse and several audits still read
 * that, and it stays exactly as it was.
 *
 * Why the set exists, and what is deliberately excluded from it (bare `dc:`
 * values, scraped numeric path segments — both of which merged thousands of
 * distinct books in the dry run): see the header of `sourceFingerprints()` in
 * `src/lib/dedup.ts`.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-source-fingerprints.mjs --dry-run
 *   node scripts/maintenance/backfill-source-fingerprints.mjs
 *
 *   --dry-run          compute and report, write nothing
 *   --collection NAME  just one of books | books_warehouse
 *   --all              recompute even where the field is already present
 *                      (needed after a change to the derivation rules)
 *   --no-index         skip creating the multikey index
 */
import { MongoClient } from 'mongodb';
import { sourceFingerprints } from '../lib/source-fingerprints.mjs';

const DRY = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all');
const NO_INDEX = process.argv.includes('--no-index');
const argAt = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const ONLY = argAt('--collection');

const COLLECTIONS = ['books', 'books_warehouse'].filter((c) => !ONLY || c === ONLY);
if (COLLECTIONS.length === 0) { console.error(`unknown --collection ${ONLY}`); process.exit(2); }

const PROJECTION = {
  id: 1, source_fingerprint: 1, source_fingerprints: 1,
  ia_identifier: 1, gallica_ark: 1, bodleian_uuid: 1, mdz_id: 1, bsb_id: 1,
  google_books_id: 1, image_source: 1, dublin_core: 1,
};

const eq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is not set — source .env.production.local with SEMICOLONS, not &&'); process.exit(2); }

const mc = new MongoClient(uri);
await mc.connect();
const db = mc.db('bookstore');

let grandModified = 0;
for (const name of COLLECTIONS) {
  const coll = db.collection(name);

  if (!DRY && !NO_INDEX) {
    // Multikey + sparse: tier 1 does `{ source_fingerprints: { $in: [...] } }`
    // on every import, which is a collection scan without this.
    await coll.createIndex({ source_fingerprints: 1 }, { name: 'idx_source_fingerprints', sparse: true });
    console.log(`[${name}] index idx_source_fingerprints ensured`);
  }

  const filter = ALL ? {} : { source_fingerprints: { $exists: false } };
  const total = await coll.countDocuments(filter);
  console.log(`[${name}] candidates: ${total}${ALL ? ' (--all: recomputing everything)' : ''}`);

  let scanned = 0, computed = 0, unchanged = 0, empty = 0, modified = 0;
  let bulk = [];
  const flush = async () => {
    if (bulk.length === 0) return;
    if (DRY) { bulk = []; return; }
    const res = await coll.bulkWrite(bulk, { ordered: false });
    modified += res.modifiedCount;
    bulk = [];
  };

  const cursor = coll.find(filter, { projection: PROJECTION });
  for await (const doc of cursor) {
    scanned++;
    const fps = sourceFingerprints(doc);
    if (fps.length === 0) { empty++; }
    else if (eq(doc.source_fingerprints, fps)) { unchanged++; }
    else {
      computed++;
      bulk.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { source_fingerprints: fps } } } });
      if (bulk.length >= 1000) await flush();
    }
    if (scanned % 20000 === 0) console.log(`[${name}] scanned ${scanned}/${total} …`);
  }
  await flush();

  console.log(`[${name}] scanned=${scanned} to_write=${computed} already_correct=${unchanged} no_identifier=${empty} modifiedCount=${DRY ? '(dry-run)' : modified}`);
  grandModified += modified;
}

console.log(`TOTAL modifiedCount: ${DRY ? '(dry-run — nothing written)' : grandModified}`);
await mc.close();
