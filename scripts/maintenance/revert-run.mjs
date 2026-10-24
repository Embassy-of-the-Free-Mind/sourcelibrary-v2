/**
 * Undo a whole run of page-text edits by its run_id (#7058).
 *
 * PRIOR ART: src/lib/page-revisions.ts restoreRevision() restores ONE page from ONE revision
 * and checks nothing about what is on the page now; hand-written restores (2026-10-21, after
 * reset-book-ocr cleared 759 pages) were one-offs. This script is the bulk, safe form, and only
 * works on rows written by writePageText() (scripts/lib/page-text-writer.mjs), which carry
 * run_id, the whole prior field, and the hash of what the run wrote.
 *
 * For every page × field the run touched, it restores the field from the run's revision, ONLY
 * if the page still holds exactly what the run wrote — a page someone (scholar, Claude, the
 * pipeline) changed since is listed and left alone. The restore is itself an edit through the
 * writer (run_id `revert:<run-id>`), so the revert can be reverted. Books that got text back
 * are recounted with recountBook().
 *
 * It restores TEXT only. A reset-book-ocr run also ended batch jobs, bumped ocr_generation and
 * requeued the book at archive_complete; those are not undone here (the requeue is harmless
 * once the text is back: lanes select pages without text). Check the book's status after.
 *
 * Usage (dry run by default):
 *   node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id <id> [--apply]
 */
import { MongoClient } from 'mongodb';
import { revertRun } from '../lib/page-text-writer.mjs';
import { recountBook } from '../lib/page-counts.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const i = args.indexOf('--run-id');
const RUN_ID = i !== -1 ? args[i + 1] : null;
if (!RUN_ID || RUN_ID.startsWith('--')) {
  console.error('Usage: node scripts/maintenance/revert-run.mjs --run-id <id> [--apply]');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
try {
  console.log(`=== revert run ${RUN_ID} ${APPLY ? '(APPLY)' : '(dry run — nothing written)'} ===`);
  const res = await revertRun(db, RUN_ID, { apply: APPLY });
  console.log(`revision rows: ${res.rows} | page×field targets: ${res.targets}`);
  console.log(`restorable (page still holds the run's text): ${res.restorable}`);
  console.log(`changed since the run (left alone): ${res.changed.length}`);
  for (const c of res.changed.slice(0, 20)) console.log(`  ${c.book_id} ${c.page_id} ${c.field}`);
  if (res.changed.length > 20) console.log(`  … ${res.changed.length - 20} more`);
  if (res.missing.length) console.log(`pages no longer present: ${res.missing.length}`);
  if (res.rows === 0) console.log('No writer rows carry this run_id — only runs made through writePageText() can be reverted here.');
  if (APPLY) {
    console.log(`restore results: ${JSON.stringify(res.tally)}`);
    for (const bookId of res.book_ids) {
      const r = await recountBook(db, bookId, { reason: `revert-run ${RUN_ID}` });
      console.log(`recount ${bookId}: ocr ${r.before?.pages_ocr ?? '?'}→${r.after?.pages_ocr} translated ${r.before?.pages_translated ?? '?'}→${r.after?.pages_translated}`);
    }
    console.log(`Undo this revert: node scripts/maintenance/revert-run.mjs --run-id revert:${RUN_ID}`);
  } else {
    console.log(`books affected: ${res.book_ids.length}${res.book_ids.length ? ` (${res.book_ids.slice(0, 10).join(', ')})` : ''}`);
    console.log('Re-run with --apply to restore.');
  }
} finally {
  await client.close();
}
