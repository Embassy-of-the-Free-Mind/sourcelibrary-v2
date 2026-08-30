#!/usr/bin/env node
/**
 * Delete embedding rows whose `book_id` no longer exists in `bookstore.books`.
 * These are orphaned — the source book was deleted (or never imported) and the
 * embedding is unreachable through any UI / RPC.
 *
 * SCOPE: pure vector embedding tables only — book_embeddings, artwork_embeddings,
 * gallery_text_embeddings, clip_embeddings. Deletes are recoverable by re-running
 * the embed worker — which is BILLED, so a delete is not costless to undo
 * (see .claude/docs/embeddings.md).
 *
 * NOT in scope: `page_translations`. That table holds the **translation text
 * itself** (column `translation`, the Gemini Batch API output), not just an
 * embedding. Deleting from it destroys readable content. See the page_translations
 * section below — it intentionally does NOT emit any DELETE SQL.
 *
 * We do NOT delete embeddings for hidden books — visibility toggles and
 * re-embedding (especially page-level) is expensive.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/delete-stale-embeddings.mjs            # dry-run
 *   node scripts/maintenance/delete-stale-embeddings.mjs --apply    # write
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!MONGODB_URI || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Need MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const mongo = await MongoClient.connect(MONGODB_URI);
const db = mongo.db('bookstore');
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

console.log('Loading book_ids from Mongo…');
const validIds = new Set();
const cursor = db.collection('books').find({}, { projection: { id: 1, _id: 1 } });
for await (const b of cursor) {
  if (b.id) validIds.add(String(b.id));
  if (b._id) validIds.add(String(b._id));
}
console.log(`  ${validIds.size} candidate id strings.\n`);

// REST-paged tables — small enough that scan-and-dedupe is fine.
const SMALL_TABLES = [
  { name: 'book_embeddings',         key: 'book_id' },
  { name: 'artwork_embeddings',      key: 'book_id' },
  { name: 'gallery_text_embeddings', key: 'book_id' },
  { name: 'clip_embeddings',         key: 'book_id' },
];

const PAGE = 1000;

for (const t of SMALL_TABLES) {
  let from = 0;
  const seen = new Set();
  while (true) {
    const { data, error } = await sb.from(t.name).select(t.key).range(from, from + PAGE - 1);
    if (error) { console.error(`  ${t.name} fetch error: ${error.message}`); break; }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const v = row[t.key];
      if (v != null) seen.add(String(v));
    }
    from += PAGE;
    if (data.length < PAGE) break;
  }
  const orphans = [...seen].filter(id => !validIds.has(id));
  console.log(`${t.name.padEnd(28)} distinct_book_ids=${seen.size}  orphans=${orphans.length}`);

  if (!APPLY || orphans.length === 0) continue;

  let deleted = 0;
  for (let i = 0; i < orphans.length; i += 100) {
    const chunk = orphans.slice(i, i + 100);
    const { error, count } = await sb.from(t.name).delete({ count: 'exact' }).in(t.key, chunk);
    if (error) { console.error(`  delete error: ${error.message}`); break; }
    deleted += count ?? 0;
  }
  console.log(`${t.name.padEnd(28)} DELETED ${deleted} rows.`);
}

// page_translations is intentionally NOT cleaned by this script. The table
// holds the **translation text itself** (column `translation`, Gemini Batch
// API output), so a DELETE there destroys readable content — not just a
// re-derivable vector. Counting orphans is fine; deleting them needs a
// separate, much-more-careful workflow (cross-check against bookstore.books
// AND deleted_books, sample inspect, ideally archive before delete).
console.log(`
─── page_translations: NOT cleaned by this script ─────────────
page_translations.translation holds Gemini-translated text — deleting
rows there is destructive in a way these embedding tables are not.

Counting orphans (read-only, safe):
  SELECT COUNT(*) FROM page_translations p
   WHERE NOT EXISTS (
     SELECT 1 FROM book_embeddings b WHERE b.book_id::text = p.book_id::text
   );

If you find orphans worth removing, write a deliberate script that:
  1. Builds the live-book set from bookstore.books (NOT book_embeddings —
     books with translations may not yet have an embedding row).
  2. Cross-checks candidate book_ids against bookstore.deleted_books so
     restorable books are spared.
  3. Samples 10–20 of the resulting "true orphans" and inspects them.
  4. Archives the rows (or at least the translation text) before DELETE.
───────────────────────────────────────────────────────────────`);

if (!APPLY) console.log('\nDry-run only. Re-run with --apply to delete from the four small tables.');

await mongo.close();
