#!/usr/bin/env node
/**
 * Create or refresh the `en-espanol` collection — every visible book that has a
 * Spanish edition (`books.pages_translated_es > 0`, kept by
 * sync-pages-translated-es.mjs). The /es homepage's "Leer en español" band links
 * here as "Todos los libros en español".
 *
 * Idempotent: upserts the collection doc (never overwriting curated fields such
 * as highlighted_books / hero_image once set), tags qualifying books with the
 * slug via $addToSet, and un-tags books that no longer qualify (hidden, or
 * counter reset to 0). Membership is derived, so there is nothing to curate by
 * hand except the editorial fields.
 *
 * Usage: node --env-file=.env.production.local scripts/maintenance/sync-es-collection.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SLUG = 'en-espanol';
const dryRun = process.argv.includes('--dry-run');
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is required'); process.exit(2); }

// Editorial fields, written only when the doc is first created (setOnInsert):
// a curator may rewrite them in the collection editor afterwards. The plain
// fields are ENGLISH (they render on /collections); the Spanish copy lives in
// the language-keyed `localized.es` map that /es/collections reads — one map
// per record, never name_es columns (src/lib/localized.ts).
const EDITORIAL = {
  name: 'Books in Spanish',
  subtitle: 'The most-read works in the library, in a Spanish edition',
  description:
    'Primary sources of alchemy, Hermetism, philosophy and early science that can be read in Spanish, ' +
    'page by page beside the original. Every book in this collection has a Spanish edition: ' +
    'open it and choose «Español» in the reader.',
  localized: {
    es: {
      name: 'Libros en español',
      subtitle: 'Las obras más leídas de la biblioteca, en edición española',
      description:
        'Fuentes primarias de alquimia, hermetismo, filosofía y ciencia temprana que puedes leer en español, ' +
        'página a página junto al original. Cada libro de esta colección tiene una edición en español: ' +
        'ábrelo y elige «Español» en el lector.',
    },
  },
  color: 'gold',
  order: 5,
  visible: true,
  created_by: 'scripts/maintenance/sync-es-collection.mjs',
};

const MEMBER_FILTER = { pages_translated_es: { $gt: 0 }, visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' } };

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const collections = db.collection('collections');

const members = await books.find(MEMBER_FILTER, { projection: { _id: 0, id: 1, title: 1, language: 1, collections: 1, read_count: 1, pages_translated_es: 1, pages_count: 1 } })
  .sort({ read_count: -1 }).toArray();
const memberIds = new Set(members.map((b) => b.id));
const stale = await books.find({ collections: SLUG, id: { $nin: [...memberIds] } }, { projection: { _id: 0, id: 1, title: 1 } }).toArray();

console.log(`${members.length} qualifying books; ${stale.length} tagged books no longer qualify`);
for (const b of members) console.log(`  + ${b.id}  reads=${b.read_count ?? 0}  es=${b.pages_translated_es}/${b.pages_count}  ${(b.title || '').slice(0, 60)}`);
for (const b of stale) console.log(`  - ${b.id}  ${(b.title || '').slice(0, 60)}`);

if (dryRun) { console.log('[dry-run] nothing written'); await client.close(); process.exit(0); }

const toTag = members.filter((b) => !(b.collections || []).includes(SLUG)).map((b) => b.id);
if (toTag.length) {
  const r = await books.updateMany({ id: { $in: toTag } }, { $addToSet: { collections: SLUG } });
  console.log(`tagged ${r.modifiedCount}/${toTag.length}`);
  for (const id of toTag) await recordSweepAction(db, { sweep: 'sync-es-collection', book_id: id, action: 'tagged-en-espanol' });
}
if (stale.length) {
  const r = await books.updateMany({ id: { $in: stale.map((b) => b.id) } }, { $pull: { collections: SLUG } });
  console.log(`untagged ${r.modifiedCount}/${stale.length}`);
  for (const b of stale) await recordSweepAction(db, { sweep: 'sync-es-collection', book_id: b.id, action: 'untagged-en-espanol' });
}

// Language breakdown + counts, same shape createCollection() computes.
const langCounts = new Map();
for (const b of members) { const l = b.language || 'Unknown'; langCounts.set(l, (langCounts.get(l) || 0) + 1); }
const languages = [...langCounts.entries()].map(([lang, count]) => ({ lang, count })).sort((a, b) => b.count - a.count);
const sample_books = members.slice(0, 6).map((b) => ({ id: b.id, title: b.title }));

const now = new Date();
const r = await collections.updateOne(
  { slug: SLUG },
  {
    $setOnInsert: { slug: SLUG, created_at: now, ...EDITORIAL },
    $set: { book_count: members.length, total_book_count: members.length, languages, sample_books, updated_at: now },
  },
  { upsert: true },
);
console.log(r.upsertedCount ? `created collection "${SLUG}"` : `refreshed collection "${SLUG}" (matched ${r.matchedCount})`);
console.log(`https://sourcelibrary.org/collections/${SLUG}`);
await client.close();
