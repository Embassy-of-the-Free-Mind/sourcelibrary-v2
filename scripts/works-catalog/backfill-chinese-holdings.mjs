#!/usr/bin/env node
/**
 * Post-import backfill for the Chinese philosophy acquisition (#2453):
 *   (a) MONGO: stamp original_language='Chinese' + text_role='original' on the
 *       imported philosophy books that lack it (the /api/import/ia route only
 *       wrote `language`; these are classical-Chinese originals by definition).
 *   (b) SUPABASE: upsert work_holdings rows for every Mongo book carrying a
 *       catalog work_id (kr:/wd:), so the works-catalog stops under-counting
 *       what we hold. Idempotent.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/works-catalog/backfill-chinese-holdings.mjs --dry-run
 *   node scripts/works-catalog/backfill-chinese-holdings.mjs --commit
 */
import { MongoClient } from 'mongodb';

const COMMIT = process.argv.includes('--commit');
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const books = c.db('bookstore').collection('books');

  // (a) original_language + text_role on imported originals lacking it
  const langFilter = { work_id: { $regex: '^(kr:|wd:)' }, language: /chinese/i, original_language: { $exists: false } };
  const langCount = await books.countDocuments(langFilter);
  console.log(`(a) books needing original_language/text_role: ${langCount}`);
  if (COMMIT && langCount) {
    const r = await books.updateMany(langFilter, { $set: { original_language: 'Chinese', text_role: 'original', updated_at: new Date() } });
    console.log(`    set original_language+text_role on ${r.modifiedCount}`);
  }

  // (b) work_holdings upsert for every book with a catalog work_id
  const held = await books.find({ work_id: { $regex: '^(kr:|wd:)' } }, { projection: { id: 1, work_id: 1, visible: 1 } }).toArray();
  console.log(`(b) Mongo books with catalog work_id: ${held.length}`);
  // existing holdings to avoid dup rows (composite work_id+book_id)
  const existing = new Set();
  let f = 0; const s = 1000;
  while (true) {
    const r = await fetch(`${URL}/rest/v1/work_holdings?select=work_id,book_id`, { headers: { ...H, Range: `${f}-${f + s - 1}` } });
    if (!r.ok) break; const rows = await r.json(); rows.forEach(x => existing.add(`${x.work_id}|${x.book_id}`));
    if (rows.length < s) break; f += s;
  }
  const fresh = held.filter(b => !existing.has(`${b.work_id}|${b.id}`));
  console.log(`    new work_holdings rows to insert: ${fresh.length} (${existing.size} already mapped)`);
  if (COMMIT && fresh.length) {
    for (let i = 0; i < fresh.length; i += 500) {
      const batch = fresh.slice(i, i + 500).map(b => ({ work_id: b.work_id, book_id: b.id, matched_by: 'import-batch-2026-06', visible: b.visible === true }));
      const r = await fetch(`${URL}/rest/v1/work_holdings`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(batch) });
      if (!r.ok) { console.error('  insert error', r.status, (await r.text()).slice(0, 200)); break; }
      console.log(`    inserted ${Math.min(i + 500, fresh.length)}/${fresh.length}`);
    }
  }
  await c.close();
  console.log(COMMIT ? 'DONE' : 'DRY-RUN (no writes)');
}
main().catch(e => { console.error(e); process.exit(1); });
