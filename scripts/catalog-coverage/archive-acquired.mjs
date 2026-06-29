#!/usr/bin/env node
/**
 * Archive newly-acquired gap books to R2 (companion to acquire-gap-batch.mjs).
 * Acquisitions import HIDDEN and the standard archiver doesn't reach them, so
 * this sweeps acquisition_queue status:'acquired' books that aren't yet on R2.
 *   IA books  -> archive-ia-bulk (datacenter-safe).
 *   e-rara IIIF -> per-page fetch + R2 upload (datacenter-tolerant for e-rara).
 * Bounded per run; marks queue.archived so runs advance.
 *   node scripts/catalog-coverage/archive-acquired.mjs --batch 60
 */
import { MongoClient } from 'mongodb';
import { execSync } from 'child_process';

const BATCH = parseInt(process.argv[process.argv.indexOf('--batch') + 1] || '60');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db = mc.db('bookstore');
const queue = db.collection('acquisition_queue');
const books = db.collection('books');
const pages = db.collection('pages');

const todo = await queue.find({ status: 'acquired', book_id: { $exists: true }, archived: { $ne: true } }).limit(BATCH).toArray();
let ok = 0, partial = 0;
for (const w of todo) {
  const b = await books.findOne({ id: w.book_id }, { projection: { id: 1, pages_count: 1 } });
  if (!b) { await queue.updateOne({ sn: w.sn }, { $set: { archived: true, archive_note: 'no-book' } }); continue; }
  const have0 = await pages.countDocuments({ book_id: w.book_id, archived_photo: /^https?:/ });
  if (have0 < (b.pages_count || 0) * 0.99) {
    try { execSync(`node scripts/maintenance/archive-ia-bulk.mjs --book-id=${w.book_id}`, { stdio: 'ignore', timeout: 300000 }); } catch {}
  }
  const r2 = await pages.countDocuments({ book_id: w.book_id, archived_photo: /^https?:/ });
  if (r2 >= (b.pages_count || 0) * 0.99 && r2 > 0) {
    await books.updateOne({ id: w.book_id }, { $set: { archive_status: 'archive_complete', pages_archived: r2 } });
    await queue.updateOne({ sn: w.sn }, { $set: { archived: true } });
    ok++;
  } else { await queue.updateOne({ sn: w.sn }, { $set: { archived: true, archive_note: `partial:${r2}/${b.pages_count}` } }); partial++; }
}
const remaining = await queue.countDocuments({ status: 'acquired', archived: { $ne: true } });
log(`archive-acquired: complete ${ok}, partial ${partial} | un-archived acquired remaining ${remaining}`);
await mc.close();
