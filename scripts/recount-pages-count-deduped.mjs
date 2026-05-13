#!/usr/bin/env node
/**
 * Recount books.pages_count for every book in the dedup-reviewed snapshot
 * list so it equals the count of visible pages (page_number > 0). The next
 * sync-worker run will keep it correct after the code fix.
 */
import { MongoClient } from 'mongodb';
import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

const snapDir = resolve(REPO_ROOT, '.claude/docs/snapshots');
const bookIds = new Set(
  readdirSync(snapDir)
    .filter(f => f.startsWith('dedup-reviewed-') && f.endsWith('.json'))
    .map(f => f.replace(/^dedup-reviewed-/, '').replace(/-\d{4}-\d{2}-\d{2}T.*\.json$/, ''))
);

console.log(`${bookIds.size} books to recount`);
let fixed = 0, unchanged = 0;
for (const id of bookIds) {
  const b = await db.collection('books').findOne({ id }, { projection: { pages_count: 1 } });
  if (!b) continue;
  const visible = await db.collection('pages').countDocuments({ book_id: id, page_number: { $gt: 0 } });
  if ((b.pages_count || 0) !== visible) {
    await db.collection('books').updateOne({ id }, { $set: { pages_count: visible, updated_at: new Date() } });
    fixed++;
  } else {
    unchanged++;
  }
  if ((fixed + unchanged) % 100 === 0) console.log(`  ${fixed + unchanged}/${bookIds.size}, fixed=${fixed}, unchanged=${unchanged}`);
}
console.log(`\nDone: fixed=${fixed}, unchanged=${unchanged}`);
await c.close();
