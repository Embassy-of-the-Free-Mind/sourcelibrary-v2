#!/usr/bin/env node
/**
 * Audit: a book badged `is_fully_translated` must actually be mostly translated (#5063).
 *
 * PRIOR ART: scripts/audit/r2-key-book-scope.mjs — same standing-detector shape
 *   (PASS/FAIL, exit 1 on findings, --json), but it audits image keys, not counters.
 *   scripts/workers/enrichment-snapshot.mjs computes pipeline stats for /progress
 *   and never fails; this needs to fail.
 *
 * THE INVARIANT
 *   `books.is_fully_translated: true` means a reader can read the book. A book with
 *   fewer than HALF its pages translated is not that, whatever its counters say.
 *
 * WHY IT MATTERS
 *   sync-worker.mjs set the flag from `pages_translated >= pages_ocr - pages_blank`.
 *   The denominator was OCR'd pages, so a book whose only OCR was the 25-page preview
 *   read as fully translated: 2,086 books on 2026-09-25, 1,369 of them visible (10.4%
 *   of every visible fully-translated book), several minted that week. The flag
 *   feeds /contribute, the storage-stats cron, and every agent that trusts it.
 *   The rule now lives in computeTranslationMetrics() (scripts/lib/page-counts.mjs)
 *   and requires OCR coverage too; this audit is what notices if a writer that
 *   does not go through it — or a future edit to it — brings the shape back.
 *
 * THE QUERY
 *   is_fully_translated: true
 *   AND pages_count > 30            (a preview covers a pamphlet legitimately)
 *   AND pages_translated < 0.5 * pages_count
 *
 *   Deliberately looser than the writer's rule (90% OCR coverage), so it flags
 *   only the unambiguous shape and never argues with a marginal book.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/fully-translated-coverage.mjs            # totals + visible, sample ids
 *   node scripts/audit/fully-translated-coverage.mjs --json out.json
 *
 * EXIT: 0 = PASS (no offending books), 1 = FAIL (count > 0), 2 = could not run.
 */

import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const SAMPLE = 10;

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }

const MIN_PAGES = 30;
const MAX_TRANSLATED_SHARE = 0.5;

// $expr keeps this a single server-side pass; the audit runs on demand, not on
// a request path, so the collection scan is acceptable (request-path-queries.md).
const OFFENDING = {
  is_fully_translated: true,
  pages_count: { $gt: MIN_PAGES },
  $expr: {
    $lt: [
      { $ifNull: ['$pages_translated', 0] },
      { $multiply: [MAX_TRANSLATED_SHARE, '$pages_count'] },
    ],
  },
};

const client = new MongoClient(uri);
try {
  await client.connect();
  const books = client.db('bookstore').collection('books');

  const total = await books.countDocuments(OFFENDING);
  const visible = await books.countDocuments({ ...OFFENDING, visible: true });
  const badgedTotal = await books.countDocuments({ is_fully_translated: true });
  const badgedVisible = await books.countDocuments({ is_fully_translated: true, visible: true });

  console.log(`is_fully_translated: true with pages_count > ${MIN_PAGES} and pages_translated < ${MAX_TRANSLATED_SHARE * 100}% of pages_count`);
  console.log(`  total:   ${total} / ${badgedTotal} badged`);
  console.log(`  visible: ${visible} / ${badgedVisible} badged visible`);

  if (total === 0) {
    console.log('\nPASS — every fully-translated badge sits on a book at least half translated.');
    if (JSON_OUT) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(JSON_OUT, JSON.stringify({ checked_at: new Date().toISOString(), total, visible, sample: [] }, null, 2));
    }
    process.exit(0);
  }

  const sample = await books
    .find({ ...OFFENDING, visible: true }, {
      projection: { _id: 1, id: 1, title: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, 'pipeline_auto.status': 1 },
    })
    .sort({ pages_count: -1 })
    .limit(SAMPLE)
    .toArray();

  console.log(`\nFAIL — ${total} book(s) carry the badge with under half their pages translated (${visible} visible).\n`);
  for (const b of sample) {
    const id = b.id || b._id.toString();
    console.log(`  ${id} "${(b.title || '?').slice(0, 50)}" ${b.pages_translated ?? 0}/${b.pages_ocr ?? 0}/${b.pages_count} translated/ocr/pages — ${b.pipeline_auto?.status || '?'}`);
  }
  if (visible > sample.length) console.log(`  ... and ${visible - sample.length} more visible`);

  if (JSON_OUT) {
    const { writeFileSync } = await import('node:fs');
    const all = await books
      .find(OFFENDING, { projection: { _id: 1, id: 1, visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 } })
      .toArray();
    writeFileSync(JSON_OUT, JSON.stringify({
      checked_at: new Date().toISOString(),
      total, visible,
      books: all.map(b => ({ id: b.id || b._id.toString(), visible: b.visible === true, pages_count: b.pages_count, pages_ocr: b.pages_ocr, pages_translated: b.pages_translated })),
    }, null, 2));
    console.log(`\nFull list written to ${JSON_OUT}`);
  }

  console.log('\nThe writer is scripts/workers/sync-worker.mjs via computeTranslationMetrics()');
  console.log('(scripts/lib/page-counts.mjs). If that rule is intact, a book listed here was');
  console.log('flagged by another writer — find it with `git grep -n is_fully_translated`.');
  process.exit(1);
} catch (err) {
  console.error(`Audit could not run: ${err?.message || err}`);
  process.exit(2);
} finally {
  await client.close().catch(() => {});
}
