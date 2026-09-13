#!/usr/bin/env node
/**
 * Reorder split halves into reading order for right-to-left books (#4796).
 *
 * PRIOR ART: none — looked in scripts/maintenance/ (fix-false-split-portrait-pages.mjs
 * repairs false splits, regen-split-gallery-images.mjs regenerates images; neither
 * touches page order) and scripts/split-book.mjs (emits the order, cannot fix it).
 *
 * split-book.mjs emitted every spread as [left, right] regardless of script. In a
 * Hebrew, Arabic, Persian or vertically-set Chinese/Japanese book the RIGHT leaf is
 * read first, so every spread of 41 books reads backwards in the reader (Pardes
 * Rimmonim: page 101 = ch. 17–18, page 100 = ch. 18–19; Sun Tzu 兵法孫子: pages
 * 39–42 carry folios 31, 30, 33, 32). split-book.mjs now emits in reading order and
 * records `books.split_page_order`; this script repairs the books split before that.
 *
 * What it does — METADATA ONLY, no image is moved or re-cut:
 *   pairs = consecutive pages (N: split_side 'left', N+1: split_side 'right')
 *   for each pair swap the two page_number values; fix books.cover_page if it
 *   pointed at either; set books.split_page_order = 'rtl'.
 * Text, images, ids, embeddings all stay attached to their page document.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/reorder-rtl-split-pages.mjs            # dry run, auto-select
 *   node --env-file=.env.production.local scripts/maintenance/reorder-rtl-split-pages.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/reorder-rtl-split-pages.mjs --book <id> [--apply]
 *   --force-ltr-language   also take books whose language is not in the RTL/CJK list (use with --book)
 *
 * Auto-select = split_completed:true, language matches the RTL/CJK list, split_page_order
 * not already 'rtl', and at least one page with split_side. A book whose halves were
 * split by the crop-era BPH path (`crop.xStart`, no split_side) is reported and
 * skipped: that path has its own order and is not covered here.
 */
import { withMongo } from '../lib/mongo.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const bookArg = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;
const FORCE_LANG = args.includes('--force-ltr-language');
const RIGHT_FIRST = /arabic|hebrew|aramaic|syriac|persian|urdu|ottoman|chinese|japanese|korean|manchu/i;

await withMongo(async (db) => {
  const B = db.collection('books'), P = db.collection('pages');
  const q = bookArg
    ? { $or: [{ id: bookArg }, { slug: bookArg }] }
    : { split_completed: true, split_page_order: { $ne: 'rtl' } };
  const books = await B.find(q).project({ _id: 0, id: 1, title: 1, language: 1, cover_page: 1, split_page_order: 1 }).toArray();
  const summary = { books: 0, skippedLanguage: 0, skippedOrdered: 0, skippedNoSplitSide: 0, pairs: 0, unpaired: 0, coverFixed: 0 };
  const rows = [];

  for (const b of books) {
    if (!RIGHT_FIRST.test(String(b.language || ''))) { if (!(bookArg && FORCE_LANG)) { summary.skippedLanguage++; continue; } }
    if (b.split_page_order === 'rtl') { summary.skippedOrdered++; console.log(`  ${b.id} already rtl — skip`); continue; }
    const pages = await P.find({ book_id: b.id, page_number: { $gte: 0 }, page_type: { $ne: 'archived-spread' } })
      .project({ _id: 1, page_number: 1, split_side: 1 }).sort({ page_number: 1 }).toArray();
    const sided = pages.filter(p => p.split_side === 'left' || p.split_side === 'right');
    if (sided.length === 0) { summary.skippedNoSplitSide++; continue; }

    // Pair strictly adjacent left→right halves; anything else is left alone and counted.
    const pairs = [];
    let unpaired = 0;
    for (let i = 0; i < pages.length; i++) {
      const a = pages[i], nb = pages[i + 1];
      if (a.split_side === 'left' && nb && nb.split_side === 'right' && nb.page_number === a.page_number + 1) { pairs.push([a, nb]); i++; }
      else if (a.split_side === 'left' || a.split_side === 'right') unpaired++;
    }
    // Shape assertion (a row count is not an integrity check): every sided page is
    // in exactly one pair, or the book is reported and skipped.
    if (unpaired > 0) {
      console.log(`  ${b.id} ${b.language} "${(b.title || '').slice(0, 40)}": ${pairs.length} pairs but ${unpaired} unpaired sided pages — SKIPPED, inspect by hand`);
      summary.unpaired += unpaired;
      continue;
    }
    summary.books++; summary.pairs += pairs.length;
    let coverFix = null;
    for (const [l, r] of pairs) {
      if (b.cover_page === l.page_number) coverFix = r.page_number;
      else if (b.cover_page === r.page_number) coverFix = l.page_number;
    }
    rows.push({ id: b.id, language: b.language, title: (b.title || '').slice(0, 40), pairs: pairs.length, pages: pages.length, coverFix });

    if (APPLY) {
      // Two-phase swap via bulkWrite: page numbers are not unique-indexed, but do
      // both halves in one batch so a crash cannot leave a pair half-swapped.
      const ops = [];
      for (const [l, r] of pairs) {
        ops.push({ updateOne: { filter: { _id: l._id }, update: { $set: { page_number: r.page_number, updated_at: new Date() } } } });
        ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { page_number: l.page_number, updated_at: new Date() } } } });
      }
      const res = await P.bulkWrite(ops, { ordered: false });
      if (res.modifiedCount !== ops.length) throw new Error(`${b.id}: expected ${ops.length} page updates, modified ${res.modifiedCount} — stop and inspect`);
      const set = { split_page_order: 'rtl', split_page_order_repaired_at: new Date(), updated_at: new Date() };
      if (coverFix != null) { set.cover_page = coverFix; summary.coverFixed++; }
      await B.updateOne({ id: b.id }, { $set: set });
      console.log(`  APPLIED ${b.id}: ${pairs.length} pairs swapped${coverFix != null ? `, cover_page → ${coverFix}` : ''}`);
    }
  }

  console.table(rows);
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}:`, JSON.stringify(summary));
  if (!APPLY) console.log('No writes. Re-run with --apply to swap page numbers.');
});
