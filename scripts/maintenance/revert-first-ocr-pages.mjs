#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/quarantine-fabricated-ocr.mjs — the same revision-then-unset
// write, but it re-measures ink and refuses any page that is not BLANK; these pages carry print
// (a Manchu column the engine dropped, a table it looped on). scripts/maintenance/reset-book-ocr.mjs
// — whole books, and it requeues them; these books stay held and only named pages are cleared.
/**
 * Take back a FIRST OCR read on named pages (#5660: Paddle on mixed-script and looped pages).
 *
 * The pages had no text before the lane wrote them, so there is nothing to restore: the read is
 * copied to `page_revisions` (source `--source`, with the whole `ocr` block under `previous_ocr`)
 * and to a local JSONL, and only then `ocr` is unset. A page is touched only while it still holds
 * the read it was listed for (`ocr.pipeline` equals `--pipeline`) and has no translation. A book
 * with a live OCR batch job is skipped (#2449: the collector would write the text back).
 * The book's counters are recounted through `recountBook()` (scripts/lib/page-counts.mjs).
 * Nothing is requeued: the caller decides the next reader. Undo: `--undo <backup.jsonl>` puts the
 * `ocr` block back on pages that still have none.
 *
 *   node --env-file=.env.production.local scripts/maintenance/revert-first-ocr-pages.mjs \
 *     --in pages.json --pipeline paddle-zh-2026-10 --source revert-paddle-5660 --reason '#5660 …' --backup out.jsonl [--apply]
 *   … --undo out.jsonl [--apply]
 * `pages.json` is `{ "<book_id>": [page_number, …], … }`.
 */
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { recountBook } from '../lib/page-counts.mjs';

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');

async function recount(db, bookIds) {
  for (const id of bookIds) {
    const before = await db.collection('books').findOne({ id }, { projection: { pages_ocr: 1 } });
    await recountBook(db, id, { reason: 'revert-first-ocr-pages' });
    const after = await db.collection('books').findOne({ id }, { projection: { pages_ocr: 1 } });
    if (before?.pages_ocr !== after?.pages_ocr) console.log(`  counter ${id} pages_ocr ${before?.pages_ocr ?? '?'} -> ${after?.pages_ocr ?? '?'}`);
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const pages = db.collection('pages');
  const tally = {};
  const count = (k) => { tally[k] = (tally[k] || 0) + 1; };
  const touched = new Set();
  try {
    const undoFile = arg('--undo');
    if (undoFile) {
      for (const line of fs.readFileSync(undoFile, 'utf8').split('\n').filter(Boolean)) {
        const { doc } = JSON.parse(line);
        if (!APPLY) { count('would_restore'); continue; }
        const res = await pages.updateOne({ id: doc.id, ocr: { $exists: false } }, { $set: { ocr: { ...doc.ocr, updated_at: new Date(doc.ocr.updated_at) } } });
        count(res.modifiedCount === 1 ? 'restored' : 'has_text_now');
        if (res.modifiedCount === 1) touched.add(doc.book_id);
      }
      if (APPLY) await recount(db, touched);
      console.log(JSON.stringify(tally));
      return;
    }

    const list = JSON.parse(fs.readFileSync(arg('--in'), 'utf8'));
    const pipeline = arg('--pipeline'), source = arg('--source'), reason = arg('--reason'), backupFile = arg('--backup');
    if (!pipeline || !source || !reason || !backupFile) throw new Error('--in, --pipeline, --source, --reason and --backup are required');
    const backup = APPLY ? fs.createWriteStream(backupFile, { flags: 'a' }) : null;
    for (const [bookId, numbers] of Object.entries(list)) {
      const live = await db.collection('batch_jobs').countDocuments({ book_id: bookId, status: { $in: ['pending', 'processing', 'submitted', 'running'] } });
      if (live > 0) { console.log(`${bookId}: ${live} live batch job(s), book skipped`); tally.book_busy = (tally.book_busy || 0) + numbers.length; continue; }
      const docs = await pages.find({ book_id: bookId, page_number: { $in: numbers } }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, 'translation.data': 1 } }).toArray();
      const found = new Set(docs.map((d) => d.page_number));
      for (const n of numbers) if (!found.has(n)) count('page_not_found');
      for (const doc of docs) {
        if (!doc.ocr?.data) { count('no_text'); continue; }
        if (doc.ocr.pipeline !== pipeline) { count('other_read_now'); continue; }
        if (doc.translation?.data) { count('has_translation'); continue; }
        if (!APPLY) { count('would_revert'); continue; }
        backup.write(JSON.stringify({ reverted_at: new Date().toISOString(), reason, doc: { id: doc.id, book_id: doc.book_id, page_number: doc.page_number, ocr: doc.ocr } }) + '\n');
        await db.collection('page_revisions').insertOne({
          id: randomBytes(6).toString('hex'), page_id: doc.id, book_id: doc.book_id, page_number: doc.page_number,
          field: 'ocr', data: doc.ocr.data, source, model: doc.ocr.model ?? null, language: doc.ocr.language ?? null,
          reason, content_hash: doc.ocr.content_hash ?? null, original_date: doc.ocr.updated_at ?? null,
          previous_ocr: doc.ocr, created_at: new Date(),
        });
        const res = await pages.updateOne({ id: doc.id, 'ocr.pipeline': pipeline, 'ocr.content_hash': doc.ocr.content_hash }, { $unset: { ocr: '' }, $set: { updated_at: new Date() } });
        if (res.modifiedCount === 1) { count('reverted'); touched.add(bookId); } else count('write_raced');
      }
    }
    if (backup) await new Promise((r) => backup.end(r));
    if (APPLY) await recount(db, touched);
    console.log(JSON.stringify(tally));
    if (!APPLY) console.log('DRY RUN: nothing was written.');
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
