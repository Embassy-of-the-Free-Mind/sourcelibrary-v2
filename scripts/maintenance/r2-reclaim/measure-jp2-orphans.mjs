/**
 * Pass 3: `archive/` JP2 orphans.
 *
 * Every `archive/{bookId}/...` dir is a set of JP2 source masters. A dir is an
 * ORPHAN when its bookId exists in NONE of: books, deleted_books, failed_imports
 * (purged books whose R2 masters were never cleaned up). Read-only; writes a
 * delete manifest of orphan dir prefixes (re-listed at delete time — we store
 * the prefix + count + bytes, not the keys).
 *
 * Usage: set -a; source .env.production.local; set +a;
 *        node scripts/maintenance/r2-reclaim/measure-jp2-orphans.mjs
 */
import { makeS3, mongo, bookGroups, NdjsonWriter, outPath, human, loadLiveBookIds } from './lib.mjs';
import fs from 'node:fs';

const s3 = makeS3();
const client = await mongo();
const db = client.db('bookstore');

// 1. Aggregate archive/ per book dir (constant memory — one group at a time).
const dirs = []; // { bookId, objects, bytes }
let objs = 0, bytes = 0, lastLog = Date.now();
for await (const g of bookGroups(s3, 'archive/', {})) {
  const b = g.entries.reduce((sum, e) => sum + e.size, 0);
  dirs.push({ bookId: g.bookId, objects: g.entries.length, bytes: b });
  objs += g.entries.length; bytes += b;
  if (Date.now() - lastLog > 15000) {
    lastLog = Date.now();
    process.stderr.write(`[archive/] dirs=${dirs.length} objs=${objs} ${human(bytes)}\n`);
  }
}
process.stderr.write(`archive/ crawl done: ${dirs.length} dirs, ${objs} objs, ${human(bytes)}\n`);

// 2. Classify each dir's bookId against the live-book id set. R2 dirs are keyed
// by the book's STRING id (books.id / pages.book_id), so this is a string join,
// never an ObjectId one — see loadLiveBookIds (the id-vs-_id footgun).
process.stderr.write('loading live book id set…\n');
const alive = await loadLiveBookIds(db);
process.stderr.write(`live book ids: ${alive.size}\n`);

const mani = new NdjsonWriter(outPath('manifest-jp2-orphans.ndjson'));
let orphanDirs = 0, orphanObjs = 0, orphanBytes = 0;
let liveDirs = 0, liveObjs = 0, liveBytes = 0;
for (const d of dirs) {
  if (alive.has(d.bookId)) {
    liveDirs++; liveObjs += d.objects; liveBytes += d.bytes;
  } else {
    orphanDirs++; orphanObjs += d.objects; orphanBytes += d.bytes;
    mani.write({ dir: `archive/${d.bookId}/`, bookId: d.bookId, objects: d.objects, bytes: d.bytes, reason: 'no book/deleted_books/failed_imports record' });
  }
}
mani.close();
await client.close();

const summary = {
  measured_at: new Date().toISOString(),
  archive_total: { dirs: dirs.length, objects: objs, bytes, human: human(bytes) },
  live_masters: { dirs: liveDirs, objects: liveObjs, bytes: liveBytes, human: human(liveBytes), note: 'JP2 masters for books we still hold — separate keep/convert policy decision, NOT in delete manifest.' },
  orphans: { dirs: orphanDirs, objects: orphanObjs, bytes: orphanBytes, human: human(orphanBytes), manifest: 'manifest-jp2-orphans.ndjson' },
};
fs.writeFileSync(outPath('summary-jp2-orphans.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
