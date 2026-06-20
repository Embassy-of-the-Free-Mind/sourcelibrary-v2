#!/usr/bin/env node
/**
 * Fix a bad grounded-reconcile anchor: the canonical author cluster for
 * William Law (English nonjuror divine & Boehme editor, 1686–1761) was
 * mis-grounded during build-authors-collection — its entity was stamped with
 * William L. Shirer's VIAF (108910177) and William Towry Law's Wikidata
 * (Q18672899), so the author doc became `_id: william-l-shirer` / canonical
 * name "William L. Shirer". Searching "william law" then resolved the
 * variant slug to /author/william-l-shirer (reported via footer feedback,
 * 2026-06-19). The library holds ZERO Shirer books and 8 William Law books
 * (which were never linked, author_id NULL).
 *
 * Correct identity: William Law → Wikidata Q3177480, VIAF 56702367.
 *
 * This is a one-off correction. The systemic pattern (famous-modern-name
 * grounded onto a historical entity: jamie-oliver→Jami, elizabeth-gaskell→
 * Cotton Mather, etc.) is tracked separately for a broader reconcile audit.
 *
 * Run: set -a; source .env.production.local; set +a; \
 *      node scripts/maintenance/fix-william-law-author-identity.mjs [--apply]
 */
import { MongoClient, ObjectId } from 'mongodb';
import { writeFileSync } from 'fs';

const APPLY = process.argv.includes('--apply');
const ENTITY_ID = '6991f30efb05b02a1539b001';
const WRONG_SLUG = 'william-l-shirer';
const CORRECT = {
  slug: 'william-law',
  name: 'William Law',
  viaf_id: '56702367',
  wikidata_id: 'Q3177480',
};

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

// 1. Backup the wrong author doc
const oldDoc = await db.collection('authors').findOne({ _id: WRONG_SLUG });
if (!oldDoc) { console.error(`No author doc ${WRONG_SLUG} — already fixed?`); process.exit(1); }
const backupPath = `scripts/output/william-law-identity-fix-backup-2026-06-20.json`;
writeFileSync(backupPath, JSON.stringify({ oldAuthorDoc: oldDoc }, null, 2));
console.log(`Backed up old author doc → ${backupPath}`);

// Books authored by William Law, not yet linked (exclude the Boehme edition
// where Law is editor, not author).
const lawBooks = await db.collection('books').find(
  { author: { $regex: /^william law$|^law, william$/i } },
  { projection: { id: 1, title: 1, author_id: 1 } },
).toArray();
const toLink = lawBooks.filter(b => !b.author_id);
console.log(`William-Law-authored books: ${lawBooks.length} (${toLink.length} unlinked → will set author_id)`);

const newDoc = {
  _id: CORRECT.slug,
  canonical_name: CORRECT.name,
  slug: CORRECT.slug,
  variants: ['Law, William', 'William Law'],
  variant_slugs: ['law-william', 'william-law'],
  book_count: lawBooks.length,
  viaf_id: CORRECT.viaf_id,
  wikidata_id: CORRECT.wikidata_id,
  entity_ids: [ENTITY_ID],
  source: 'manual-correction-2026-06-20',
  corrected_from: WRONG_SLUG,
  built_at: new Date(),
};

console.log('\nPlanned changes:');
console.log(`  entities/${ENTITY_ID}: viaf 108910177→${CORRECT.viaf_id}, wikidata Q18672899→${CORRECT.wikidata_id}`);
console.log(`  authors: delete ${WRONG_SLUG}, insert ${CORRECT.slug} (${CORRECT.name})`);
console.log(`  books: set author_id=${CORRECT.slug} on ${toLink.length} books`);

if (!APPLY) { console.log('\n[dry-run] re-run with --apply'); await c.close(); process.exit(0); }

// 2. Fix entity grounding (root cause)
const e = await db.collection('entities').updateOne(
  { _id: new ObjectId(ENTITY_ID) },
  { $set: { viaf_id: CORRECT.viaf_id, wikidata_id: CORRECT.wikidata_id } },
);
console.log(`\nentity updated: matched=${e.matchedCount} modified=${e.modifiedCount}`);

// 3. Replace the author doc (delete wrong slug, insert correct)
await db.collection('authors').deleteOne({ _id: WRONG_SLUG });
await db.collection('authors').insertOne(newDoc);
console.log(`author doc replaced: ${WRONG_SLUG} → ${CORRECT.slug}`);

// 4. Link the books
const ids = toLink.map(b => b.id);
const r = await db.collection('books').updateMany(
  { id: { $in: ids } },
  { $set: { author_id: CORRECT.slug } },
);
console.log(`books linked: matched=${r.matchedCount} modified=${r.modifiedCount}`);

await c.close();
console.log('\nDone.');
