#!/usr/bin/env node
/**
 * Clear page-level `archived_photo: "failed:…"` markers so transiently-failed
 * pages become archivable again.
 *
 * THE PROBLEM
 * Archivers select work with `archived_photo` missing/null/empty. Writing a
 * `failed:` string into that field hides the page from every future run — the
 * bad write erases its own repair path. Nothing clears these today:
 * `archive-auto-unblock.mjs` unsets only book-level `archive_metadata.*`.
 * Measured 2026-08-01: 14,123 pages stranded this way.
 *
 * WHAT THIS DOES NOT DO
 * It does not archive anything. It only makes pages eligible again; the normal
 * archivers pick them up on their next run. That separation is deliberate — it
 * keeps this script cheap, idempotent and easy to reason about, and it means a
 * mistake here costs a re-queue rather than a bad write.
 *
 * SAFETY
 *  - Dry-run by DEFAULT. `--apply` is required to write.
 *  - Only `transient` markers are cleared (see scripts/lib/archive-failure-class.mjs).
 *    `404` / `source-not-found` are permanent and left alone; clearing those
 *    would re-queue work that fails again and re-marks, on a loop.
 *  - `unknown` reasons are LEFT ALONE and reported. An unrecognised marker is
 *    not evidence of recoverability.
 *  - `--max-per-provider` throttles how many pages one source gets re-queued at
 *    once, because 93.5% of markers are HTTP 403 and dumping every one back
 *    into the queue would hammer a provider that is already refusing us.
 *
 * USAGE
 *   node scripts/maintenance/clear-transient-archive-failures.mjs            # dry run, full report
 *   node scripts/maintenance/clear-transient-archive-failures.mjs --apply
 *   node scripts/maintenance/clear-transient-archive-failures.mjs --apply --max-per-provider=500
 *   node scripts/maintenance/clear-transient-archive-failures.mjs --book-id=<id> --apply
 */
import { MongoClient } from 'mongodb';
import { classifyArchiveFailure, failureReasonKey, FAILURE_CLASS } from '../lib/archive-failure-class.mjs';

const args = process.argv.slice(2);
const getArg = (n) => args.find(a => a.startsWith(`--${n}=`))?.split('=')[1];
const APPLY = args.includes('--apply');
const BOOK_ID = getArg('book-id') || null;
const MAX_PER_PROVIDER = parseInt(getArg('max-per-provider') || '0', 10) || Infinity;
const LIMIT = parseInt(getArg('limit') || '0', 10) || Infinity;
// Opt IN to clearing HTTP 403 markers. OFF by default: on this corpus 403 is
// dominated by Internet Archive `access-restricted-item` books — IA correctly
// refusing to serve in-copyright material. Only pass this after checking the
// affected books are public domain.
const INCLUDE_403 = args.includes('--include-403');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }

async function main() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db('bookstore');

  const query = { archived_photo: { $regex: '^failed:' } };
  if (BOOK_ID) query.book_id = BOOK_ID;

  if (INCLUDE_403) {
    console.log('[clear-failures] WARNING: --include-403 is ON. 403 on this corpus is dominated by');
    console.log('                 IA access-restricted (in-copyright) books. Confirm the affected');
    console.log('                 books are public domain before applying.');
  }
  console.log(`[clear-failures] ${APPLY ? 'APPLY' : 'DRY RUN'}${BOOK_ID ? ` book=${BOOK_ID}` : ''}` +
    `${MAX_PER_PROVIDER !== Infinity ? ` max-per-provider=${MAX_PER_PROVIDER}` : ''}`);

  // Resolve provider per book so throttling is per-source, not global.
  const providerByBook = new Map();
  async function providerFor(bookId) {
    if (providerByBook.has(bookId)) return providerByBook.get(bookId);
    const b = await db.collection('books').findOne({ id: bookId }, { projection: { 'image_source.provider': 1 } });
    const p = b?.image_source?.provider || 'unknown';
    providerByBook.set(bookId, p);
    return p;
  }

  const byClass = { transient: 0, permanent: 0, unknown: 0 };
  const byReason = {};
  const clearedByProvider = {};
  const seenByProvider = {};
  const toClear = [];
  let scanned = 0;

  const cursor = db.collection('pages')
    .find(query, { projection: { _id: 1, book_id: 1, page_number: 1, archived_photo: 1 } })
    .batchSize(500);

  // `archived_photo` is unindexed, so this is a collection scan over ~18.9M
  // pages and a full pass takes many minutes. Without a heartbeat the run is
  // silent the whole time and looks hung — two earlier runs were killed for
  // exactly that reason before producing any output.
  const t0 = Date.now();
  let nextTick = 500;

  for await (const page of cursor) {
    scanned++;
    if (scanned > LIMIT) break;
    if (scanned >= nextTick) {
      nextTick += 500;
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`  …scanned ${scanned} markers (${secs}s)\n`);
    }
    const { class: cls } = classifyArchiveFailure(page.archived_photo, { include403: INCLUDE_403 });
    byClass[cls] = (byClass[cls] || 0) + 1;
    const key = failureReasonKey(page.archived_photo);
    if (key) byReason[key] = (byReason[key] || 0) + 1;

    if (cls !== FAILURE_CLASS.TRANSIENT) continue;

    const prov = await providerFor(page.book_id);
    seenByProvider[prov] = (seenByProvider[prov] || 0) + 1;
    if ((clearedByProvider[prov] || 0) >= MAX_PER_PROVIDER) continue;
    clearedByProvider[prov] = (clearedByProvider[prov] || 0) + 1;
    toClear.push(page._id);
  }

  console.log(`\n  scanned: ${scanned} marker pages`);
  console.log(`  transient: ${byClass.transient}  permanent: ${byClass.permanent}  unknown: ${byClass.unknown}`);
  console.log('\n  by reason:');
  Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .forEach(([k, v]) => console.log(`    ${String(v).padStart(6)}  ${k}`));

  console.log('\n  eligible to clear, by provider:');
  Object.entries(clearedByProvider).sort((a, b) => b[1] - a[1])
    .forEach(([p, v]) => {
      const seen = seenByProvider[p] || v;
      const held = seen - v;
      console.log(`    ${String(v).padStart(6)}  ${p}${held > 0 ? `  (${held} held back by --max-per-provider)` : ''}`);
    });

  if (byClass.unknown > 0) {
    console.log(`\n  NOTE: ${byClass.unknown} marker(s) have an unrecognised reason and were LEFT ALONE.`);
    console.log('        Add a pattern to scripts/lib/archive-failure-class.mjs if they are recoverable.');
  }

  if (!APPLY) {
    console.log(`\n  DRY RUN — would clear ${toClear.length} page(s). Re-run with --apply.`);
    await client.close();
    return;
  }

  let cleared = 0;
  for (let i = 0; i < toClear.length; i += 500) {
    const chunk = toClear.slice(i, i + 500);
    const res = await db.collection('pages').updateMany(
      // Re-assert the marker in the filter: if an archiver wrote a real URL
      // between scan and write, we must not clobber it.
      { _id: { $in: chunk }, archived_photo: { $regex: '^failed:' } },
      { $unset: { archived_photo: '' }, $set: { updated_at: new Date() } }
    );
    cleared += res.modifiedCount;
  }
  console.log(`\n  CLEARED ${cleared} page(s) — now eligible for the normal archivers.`);
  console.log('  Nothing was archived by this script; the archivers do that on their next run.');

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
