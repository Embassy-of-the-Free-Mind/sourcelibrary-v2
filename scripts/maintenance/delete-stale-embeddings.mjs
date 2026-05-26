#!/usr/bin/env node
/**
 * Delete embedding rows whose `book_id` no longer exists in `bookstore.books`.
 * These are orphaned — the source book was deleted (or never imported) and the
 * embedding is unreachable through any UI / RPC.
 *
 * We do NOT delete embeddings for hidden books — visibility toggles and
 * re-embedding (especially page-level) is expensive.
 *
 * The four small tables are paged-and-deleted via the Supabase REST client.
 * `page_translations` (~3.9M rows) is too big for REST; the script emits a
 * SQL one-liner to run in the Supabase SQL editor.
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

// page_translations is too big to page via REST. Emit a SQL one-liner.
console.log(`
─── page_translations cleanup ─────────────────────────────────
Too large for REST paging (~3.9M rows). Run in Supabase SQL editor:

  -- One-shot cleanup. Replace the literal array with the current
  -- valid book_id list, or load into a temp table first if it's huge.
  -- Quick check:
  SELECT COUNT(*) FROM page_translations p
   WHERE NOT EXISTS (
     SELECT 1 FROM book_embeddings b WHERE b.book_id::text = p.book_id::text
   );
  -- (Using book_embeddings as the implicit "live book" set after this
  -- script cleans it. Once book_embeddings is orphan-free, every
  -- page_translations row whose book_id isn't there is also orphaned.)

  -- Delete (run after the COUNT looks reasonable):
  DELETE FROM page_translations p
   WHERE NOT EXISTS (
     SELECT 1 FROM book_embeddings b WHERE b.book_id::text = p.book_id::text
   );
───────────────────────────────────────────────────────────────`);

if (!APPLY) console.log('\nDry-run only. Re-run with --apply to delete from the four small tables.');

await mongo.close();
