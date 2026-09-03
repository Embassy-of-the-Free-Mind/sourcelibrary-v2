#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/quarantine-fabricated-ocr.mjs (#4149) does this
 * for fabricated OCR on BLANK leaves — it preserves to `page_revisions` then
 * `$unset`s the field. This borrows its method but cannot reuse it: there the
 * OCR is wrong and there is no correct text, so the field is removed wholesale.
 * Here the OCR is CORRECT (it honestly declined) and only PART of the
 * translation is invented, so the fix is surgical rather than a delete.
 *
 * Withdraws the fabricated translation on Urkunden IV p.24 (#4584).
 *
 * WHAT WENT WRONG. The OCR read the German apparatus correctly and recorded the
 * glyph block as unread — `[Hieroglyphic text lines x+1 through 20]`. The
 * translation phase then rendered those twenty unread lines as twenty lines of
 * English funerary formulae with no source. One of them was promoted into the
 * book's `reading_summary.quotes` and served on a `visible: true` book as a
 * quotation of Sethe, complete with an interpretive gloss about the ideal of
 * Maat, for a sentence that does not exist.
 *
 * WHAT THIS DOES, IN ORDER
 *   1. Re-reads the page NOW and asserts the fabrication is still present.
 *      A stale work list must never be able to edit a page's text.
 *   2. Writes the full prior translation to `page_revisions` with
 *      `source: 'withdraw-fabricated-translation-4584'` — nothing is destroyed
 *      and the fabrication stays auditable.
 *   3. Replaces ONLY the invented lines with a single <lacuna> marker, keeping
 *      the legitimate translation of the German apparatus (title, the Hermann/
 *      Anthes citation, "Only the final lines are preserved").
 *   4. Removes the invented featured quote from `reading_summary.quotes`.
 *
 * WHY <lacuna> AND NOT A FLAG: `<lacuna>` (#4605, merged) is registered in
 * EDITORIAL_WRAPPERS in both stripper twins, so its content is dropped from
 * quotes, ngrams, embeddings, PDF and EPUB. A flag would leave the text in
 * place for every consumer that reads `translation.data` and checks no flags.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/withdraw-fabricated-translation-4584.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';

const APPLY = process.argv.includes('--apply');
const BOOK = '69e013c593b116d24238b3d7';
const PAGE = 24;
const LACUNA = '<lacuna>20 lines of hieroglyphic text, not transcribed</lacuna>';

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

const page = await db.collection('pages').findOne({ book_id: BOOK, page_number: PAGE });
if (!page) { console.error('page not found'); process.exit(1); }
const prior = typeof page.translation === 'string' ? page.translation : (page.translation?.data || '');

// (1) Assert the fabrication is still there, on the live document.
const fabricated = prior.match(/^x\+\d+\.\s+\S.*$/gm) || [];
if (fabricated.length < 5) {
  console.error(`REFUSING: expected the invented x+N lines, found ${fabricated.length}. Already withdrawn, or the page changed.`);
  process.exit(1);
}
console.log(`page ${PAGE}: ${fabricated.length} invented lines present`);

// Replace the contiguous invented block with one marker; keep everything else.
const next = prior
  .replace(/^x\+\d+\.\s+.*(?:\n|$)/gm, '')          // drop the invented lines
  .replace(/\n{3,}/g, '\n\n')
  .replace(/(Only the final lines are preserved\n\nx\+1\n)/, `$1`)
  .trimEnd();
// Insert the marker where the invented block stood: after the <note> about the diagram.
const withMarker = next.includes(LACUNA) ? next
  : next.replace(/(<note>A large diagram[^<]*<\/note>)/, `$1\n\n${LACUNA}`);
if (!withMarker.includes(LACUNA)) {
  console.error('REFUSING: could not site the <lacuna> marker — anchor missing, would have silently dropped the gap.');
  process.exit(1);
}

const book = await db.collection('books').findOne({ id: BOOK }, { projection: { reading_summary: 1, title: 1 } });
const quotes = book?.reading_summary?.quotes || [];
const bad = quotes.filter((q) => q.page === PAGE);

console.log(`\n--- BEFORE (${prior.length} chars) ---\n${prior.slice(0, 260)}…`);
console.log(`\n--- AFTER (${withMarker.length} chars) ---\n${withMarker}`);
console.log(`\n--- featured quotes to remove: ${bad.length} ---`);
for (const q of bad) console.log(`  "${q.text.slice(0, 90)}"`);

if (!APPLY) { console.log('\n(dry run — pass --apply)'); await c.close(); process.exit(0); }

// (2) Preserve. Nothing is destroyed.
await db.collection('page_revisions').insertOne({
  id: createHash('sha1').update(`${page.id}-withdraw-4584`).digest('hex').slice(0, 12),
  page_id: page.id,
  book_id: BOOK,
  page_number: PAGE,
  field: 'translation',
  data: prior,
  source: 'withdraw-fabricated-translation-4584',
  model: page.translation?.model || null,
  language: page.translation?.language || 'en',
  reason: 'fabricated: translation supplied 20 lines of English funerary formulae for a glyph block the OCR recorded as unread',
  note: 'Issue #4584. Withdrawn 2026-09-03; invented lines replaced with a <lacuna> marker, legitimate German-apparatus translation retained.',
  created_at: new Date(),
});

// (3) Replace the text.
const r1 = await db.collection('pages').updateOne({ _id: page._id }, {
  $set: {
    'translation.data': withMarker,
    'translation.content_hash': createHash('md5').update(withMarker).digest('hex'),
    'translation.updated_at': new Date(),
    'translation.withdrawn_reason': 'fabricated-block-removed-4584',
  },
});

// (4) Remove the invented featured quote.
const r2 = await db.collection('books').updateOne({ id: BOOK }, {
  $set: {
    'reading_summary.quotes': quotes.filter((q) => q.page !== PAGE),
    updated_at: new Date(),
  },
});

console.log(`\npreserved to page_revisions; page updated=${r1.modifiedCount}; book quotes updated=${r2.modifiedCount}`);

// Verify on a fresh read.
const after = await db.collection('pages').findOne({ book_id: BOOK, page_number: PAGE });
const t = after.translation?.data || '';
const q2 = (await db.collection('books').findOne({ id: BOOK }, { projection: { reading_summary: 1 } }))?.reading_summary?.quotes || [];
console.log(`VERIFY invented lines remaining: ${(t.match(/^x\+\d+\.\s+\S/gm) || []).length} (want 0)`);
console.log(`VERIFY lacuna marker present: ${t.includes(LACUNA)}`);
console.log(`VERIFY p.${PAGE} quotes remaining: ${q2.filter((q) => q.page === PAGE).length} (want 0), total quotes now ${q2.length}`);
await c.close();
