#!/usr/bin/env node
/**
 * Flag ONE page's transcription as unreadable: 金剛般若波羅蜜經如義 (book
 * 69f1345d365e3fcae574e290), scan p. 7.
 *
 * WHY. Scan p. 7 is the blank verso of the colophon leaf. The only marks on it
 * are the 1787 colophon on p. 8 showing through the paper, mirrored: read the
 * right way round it is 乾隆五十二年歲次丁未 … 廣州海幢寺藏板 (checked by eye
 * on a mirrored, contrast-raised copy of the scan). The stored transcription
 * reads that show-through as a "Japanese colophon from the Kamakura period"
 * dated 弘安二年歲次己卯 (1279), which is not on the page. It is what made the
 * book's language detector say Japanese (see repair-catalogue-records-2026-10-18.mjs,
 * which corrected the book record).
 *
 * WHAT. The #4523 contract, as in flag-ia-empty-target-pages.mjs: snapshot to
 * page_revisions, set `ocr.unreadable` + reason (the text is kept for
 * provenance, not served or counted; translate-core skips it and the standing
 * stale-translation sweep withholds its translation), recount the book's page
 * counters, sweep_log row, revalidate the book. Reversible: unset the two fields.
 * The page is matched by book, page number AND the invented date, so it cannot
 * flag a different page.
 *
 * Usage:
 *   node --env-file=.env.local scripts/maintenance/flag-showthrough-page-ruyi-2026-10-18.mjs           # dry run
 *   node --env-file=.env.local scripts/maintenance/flag-showthrough-page-ruyi-2026-10-18.mjs --apply
 */
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { recountBook } from '../lib/page-counts.mjs';

const APPLY = process.argv.includes('--apply');
const BOOK = '69f1345d365e3fcae574e290';
const PAGE_NUMBER = 7;
const INVENTED = '弘安二年';
const REASON = 'show_through_misread_as_colophon_2026_10_18';
const SWEEP = 'flag-showthrough-page-ruyi-2026-10-18';

await withMongo(async (db) => {
  const P = db.collection('pages');
  const page = await P.findOne({ book_id: BOOK, page_number: PAGE_NUMBER }, { projection: { _id: 1, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.unreadable': 1, 'ocr.source': 1, 'translation.data': 1 } });
  if (!page) { console.error('page not found'); process.exit(1); }
  const text = String(page.ocr?.data || '');
  console.log(`page ${page.page_number} (${page.id}) source=${page.ocr?.source} unreadable=${page.ocr?.unreadable === true}`);
  console.log(`  contains ${INVENTED}: ${text.includes(INVENTED)}; has translation: ${!!page.translation?.data}`);
  console.log(`  text: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
  if (page.ocr?.unreadable === true) { console.log('already flagged'); return; }
  if (!text.includes(INVENTED)) { console.error('!! the page does not carry the invented date; refusing'); process.exit(1); }
  if (!APPLY) { console.log('-- dry run (add --apply) --'); return; }

  const now = new Date();
  await saveRevisionsBeforeOverwrite(db, [page.id], 'ocr', { reason: REASON });
  const r = await P.updateOne(
    { _id: page._id, 'ocr.unreadable': { $ne: true } },
    { $set: { 'ocr.unreadable': true, 'ocr.unreadable_reason': REASON, updated_at: now } },
  );
  console.log(`flagged: ${r.modifiedCount}`);
  const counts = await recountBook(db, BOOK, { reason: REASON, now });
  console.log(`counts: ${JSON.stringify(counts)}`);
  await recordSweepAction(db, { sweep: SWEEP, book_id: BOOK, action: 'flagged-unreadable', detail: { page_numbers: [PAGE_NUMBER], reason: REASON } });
  const rv = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${BOOK}`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  console.log(`sweep_log written; revalidate ${rv.status}`);
});
