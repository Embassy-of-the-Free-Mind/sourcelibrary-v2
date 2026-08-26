#!/usr/bin/env node
/**
 * Archive newly-acquired gap books to R2 (companion to acquire-gap-batch.mjs).
 * Acquisitions import HIDDEN and the standard archiver doesn't reach them, so
 * this sweeps acquisition_queue status:'acquired' books not yet on R2.
 *   IA books    -> archive-ia-bulk (datacenter-safe).
 *   e-rara IIIF -> per-page fetch + R2 (e-rara is datacenter-tolerant).
 * Run with tsx. Bounded per run; marks queue.archived so runs advance.
 *   npx tsx scripts/catalog-coverage/archive-acquired.ts --batch 60
 */
import { MongoClient } from 'mongodb';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { storagePut } from '../../src/lib/storage';
import { upgradeToFullRes, rateLimitedFetch } from '../lib/iiif-utils.mjs';
const execFileP = promisify(execFile);
const CONCURRENCY = parseInt(process.argv[process.argv.indexOf('--concurrency') + 1] || '6');

const BATCH = parseInt(process.argv[process.argv.indexOf('--batch') + 1] || '60');
const log = (...a: any[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const mc = new MongoClient(process.env.MONGODB_URI!); await mc.connect();
  const db = mc.db('bookstore');
  const queue = db.collection('acquisition_queue');
  const books = db.collection('books');
  const pages = db.collection('pages');

  async function archiveIiif(bookId: string) {
    const ps = await pages.find({ book_id: bookId, archived_photo: { $exists: false }, $or: [{ photo: /^https?:/ }, { photo_original: /^https?:/ }] }, { projection: { _id: 1, page_number: 1, photo: 1, photo_original: 1 } }).toArray();
    for (let i = 0; i < ps.length; i += 6) {
      await Promise.all(ps.slice(i, i + 6).map(async (p: any) => {
        const url = upgradeToFullRes(p.photo_original || p.photo);
        try {
          const buf = await rateLimitedFetch(url);
          // Archive at source fidelity: no resolution cap (#3897, matches archive-ia-bulk).
          const jpg = await sharp(buf).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer();
          const padded = String(p.page_number).padStart(4, '0');
          const blob = await storagePut(`pages/${bookId}/${padded}.jpg`, jpg, { contentType: 'image/jpeg', access: 'public' });
          const upd: any = { $set: { archived_photo: blob.url } };
          try { const th = await sharp(buf).rotate().resize(150, null, { withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer(); upd.$set.thumbnail_blob = (await storagePut(`pages/${bookId}/${padded}-thumb.jpg`, th, { contentType: 'image/jpeg', access: 'public' })).url; } catch {}
          await pages.updateOne({ _id: p._id }, upd);
        } catch {}
      }));
    }
  }

  const todo = await queue.find({ status: 'acquired', book_id: { $exists: true }, archived: { $ne: true } }).limit(BATCH).toArray();
  let ok = 0, partial = 0;
  async function processBook(w: any) {
    const b = await books.findOne({ id: w.book_id }, { projection: { id: 1, pages_count: 1 } });
    if (!b) { await queue.updateOne({ sn: w.sn }, { $set: { archived: true, archive_note: 'no-book' } }); return; }
    const have0 = await pages.countDocuments({ book_id: w.book_id, archived_photo: /^https?:/ });
    if (have0 < (b.pages_count || 0) * 0.99) {
      if (w.source === 'erara' || w.source === 'iiif' || w.source === 'mdz' || w.source === 'gallica') { await archiveIiif(w.book_id); }
      else { try { await execFileP('node', ['scripts/maintenance/archive-ia-bulk.mjs', `--book-id=${w.book_id}`], { timeout: 300000 }); } catch {} }
    }
    const r2 = await pages.countDocuments({ book_id: w.book_id, archived_photo: /^https?:/ });
    if (r2 >= (b.pages_count || 0) * 0.99 && r2 > 0) {
      await books.updateOne({ id: w.book_id }, { $set: { archive_status: 'archive_complete', pages_archived: r2 } });
      await queue.updateOne({ sn: w.sn }, { $set: { archived: true } });
      ok++;
    } else { await queue.updateOne({ sn: w.sn }, { $set: { archived: true, archive_note: `partial:${r2}/${b.pages_count}` } }); partial++; }
  }
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(todo.slice(i, i + CONCURRENCY).map(w => processBook(w).catch(() => {})));
  }
  const remaining = await queue.countDocuments({ status: 'acquired', archived: { $ne: true } });
  log(`archive-acquired: complete ${ok}, partial ${partial} | un-archived acquired remaining ${remaining}`);
  await mc.close();
}
main().catch(e => { console.error(e); process.exit(1); });
