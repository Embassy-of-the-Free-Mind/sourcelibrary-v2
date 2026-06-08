// Canonicalize the `categories` array on every book so casing/format variants
// fold into one bucket. AI enrichment historically wrote free-form casings
// ("Philosophy", "Natural Philosophy"); `categories @> [id]` matching is exact +
// case-sensitive, so those books silently dropped out of their category page and
// from category-filtered search (e.g. ~813 "Freemasonry" books missing from
// /categories/freemasonry). Canonical form = lowercase, trimmed, spaces → hyphens.
//
// Idempotent — re-running on already-canonical data is a no-op. Writes both the
// Mongo source of truth (books.categories, bumping updated_at so the 5-min
// Supabase sync propagates) and the Supabase mirror directly (immediate effect).
//
//   node scripts/maintenance/canonicalize-categories.mjs --dry
//   node scripts/maintenance/canonicalize-categories.mjs --apply
//   ...--apply --supabase-only   (skip Mongo if Atlas is unreachable)
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const SUPABASE_ONLY = process.argv.includes('--supabase-only');
const MONGO_ONLY = process.argv.includes('--mongo-only');

const canon = (s) => String(s).toLowerCase().trim().replace(/\s+/g, '-');
const normalize = (arr) => {
  if (!Array.isArray(arr)) return null;
  const out = [...new Set(arr.map(canon))].filter(Boolean);
  return out;
};
const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

async function doMongo() {
  let c;
  for (let i = 0; i < 8; i++) {
    try { c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 }); await c.connect(); break; }
    catch (e) { console.error(`mongo connect retry ${i + 1}: ${e.message}`); c = null; await new Promise(r => setTimeout(r, 3000)); }
  }
  if (!c) { console.error('Mongo: Atlas unreachable — skipping (re-run with --supabase-only or retry).'); return; }
  const db = c.db('bookstore');
  const cursor = db.collection('books').find(
    { categories: { $exists: true, $ne: [] } },
    { projection: { categories: 1 } }
  );
  let scanned = 0, changed = 0;
  const ops = [];
  for await (const b of cursor) {
    scanned++;
    const norm = normalize(b.categories);
    if (!norm || sameArr(norm, b.categories)) continue;
    changed++;
    if (APPLY) ops.push({ updateOne: { filter: { _id: b._id }, update: { $set: { categories: norm, updated_at: new Date() } } } });
    if (ops.length >= 500) { await db.collection('books').bulkWrite(ops); ops.length = 0; }
  }
  if (APPLY && ops.length) await db.collection('books').bulkWrite(ops);
  console.log(`Mongo books: scanned=${scanned}, ${APPLY ? 'updated' : 'would-update'}=${changed}`);
  await c.close();
}

async function doSupabase() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let from = 0; const PAGE = 1000;
  let scanned = 0, changed = 0;
  for (;;) {
    const { data, error } = await sb.from('books_catalog').select('id, categories').range(from, from + PAGE - 1);
    if (error) { console.error('Supabase read error:', error.message); break; }
    if (!data || !data.length) break;
    for (const row of data) {
      scanned++;
      const norm = normalize(row.categories);
      if (!norm || sameArr(norm, row.categories)) continue;
      changed++;
      if (APPLY) {
        const { error: uErr } = await sb.from('books_catalog').update({ categories: norm }).eq('id', row.id);
        if (uErr) console.error(`  update ${row.id} failed: ${uErr.message}`);
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Supabase books_catalog: scanned=${scanned}, ${APPLY ? 'updated' : 'would-update'}=${changed}`);
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY'}`);
if (!SUPABASE_ONLY) await doMongo();
if (!MONGO_ONLY) await doSupabase();
console.log('Done.');
