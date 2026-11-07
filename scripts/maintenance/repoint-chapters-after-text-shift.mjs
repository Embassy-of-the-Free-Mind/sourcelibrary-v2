#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/repair-text-offset-segments.mjs moves page text but leaves
 * books.chapters alone; scripts/maintenance/atisha-leaf-order-6142.mjs `--chapters` UNSETS chapters
 * whose titles no longer occur (a re-read, not a move). None re-points a chapter whose heading moved.
 *
 * repoint-chapters-after-text-shift — lane 3 of a segment text repair (#5803, derived-metadata-lane.md).
 *
 * A chapter list derived while the text sat one slot late points where the heading USED to be. After
 * `repair-text-offset-segments.mjs --segments "A-B:+d"`, the heading of a chapter that started on n now
 * sits on n-d. This moves pageNumber/pageId only where the CURRENT text says so (heading words on the
 * new slot and not on the old); a chapter that fails the test is left and printed. The predecessor's
 * endPage follows. The old chapter list is kept in sweep_log (undo: write it back).
 *
 * Usage (dry run by default):
 *   node --env-file=.env.production.local scripts/maintenance/repoint-chapters-after-text-shift.mjs \
 *     --book <id> --segments "404-412:+1,415-419:+1" [--issue 5803] [--apply]
 */
import { MongoClient } from 'mongodb';
import { parseSegments, repointChapters, headingInText } from '../lib/text-shift.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const BOOK = flag('book');
const SPEC = flag('segments');
const ISSUE = Number(flag('issue', 5803));
const APPLY = args.includes('--apply');
if (!BOOK || !SPEC) { console.error('usage: --book ID --segments "A-B:+d,..." [--issue N] [--apply]'); process.exit(1); }
const segments = parseSegments(SPEC);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const db = client.db('bookstore');
  const book = await db.collection('books').findOne({ id: BOOK }, { projection: { id: 1, title: 1, chapters: 1 } });
  if (!book) { console.log('[REFUSE] no book'); process.exit(2); }
  if (!Array.isArray(book.chapters) || !book.chapters.length) { console.log('no chapters'); process.exit(0); }
  const nums = new Set();
  for (const c of book.chapters) for (const s of segments) if (c.pageNumber - s.delta >= s.from && c.pageNumber - s.delta <= s.to) { nums.add(c.pageNumber); nums.add(c.pageNumber - s.delta); }
  const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $in: [...nums] } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
  const byNum = new Map(pages.map((p) => [p.page_number, p]));
  const { chapters, moved } = repointChapters(
    book.chapters, segments,
    (n, title) => headingInText(title, byNum.get(n)?.ocr?.data),
    (n) => byNum.get(n)?.id,
  );
  const inRange = book.chapters.filter((c) => nums.has(c.pageNumber)).length;
  console.log(`${String(book.title).slice(0, 60)}: ${inRange} chapters start in a moved range, ${moved.length} re-pointed`);
  for (const m of moved) console.log(`  ${m.from} → ${m.to}  ${String(m.title).slice(0, 60)}`);
  for (const c of book.chapters.filter((c) => nums.has(c.pageNumber) && !moved.some((m) => m.from === c.pageNumber))) console.log(`  left ${c.pageNumber}  ${String(c.title).slice(0, 60)} (heading not found on the new slot alone)`);
  if (!moved.length || !APPLY) { if (!APPLY) console.log('[DRY RUN] no writes — pass --apply'); process.exit(0); }
  await db.collection('books').updateOne({ id: BOOK }, { $set: { chapters, updated_at: new Date() } });
  await recordSweepAction(db, {
    sweep: `repoint-chapters-${ISSUE}`, book_id: BOOK, action: 'chapters-repointed',
    detail: { segments: SPEC, moved, chapters_before: book.chapters, issue: ISSUE },
  });
  console.log(`[OK] ${moved.length} chapters re-pointed; old list in sweep_log repoint-chapters-${ISSUE}`);
} finally {
  await client.close();
}
