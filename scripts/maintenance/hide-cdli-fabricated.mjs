#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/hide-unarchived-books.mjs and hide-efm-duplicates.mjs
 * both hide by a general RULE (no archived images; duplicate of an EFM scan) and expect
 * an automatic un-hide later. This one withholds four NAMED books whose text is
 * fabricated, which no rule can express and which must not be swept back into view.
 * scripts/import/cdli-atf-source.mjs is its other half: it repairs the books whose ATF
 * maps 1:1 onto our page.
 *
 * Withhold the CDLI cuneiform books whose "transcription" is model recall (#4851).
 *
 * A vision model does not read cuneiform from a photograph. CDLI's published ATF for
 * P102318 is "2 grain-fed sheep … from Abbasaga"; our page claims "fresh apples … to
 * the palace" at `<confidence>0.95</confidence>`. Our own research note measured the
 * ceiling and called the model "a cuneiform commentator, not a cuneiform reader"
 * (`/blog/cuneiform-ocr`) — and these four are that post's exhibit tablets, published
 * with the fabrications presented as transcription and translation.
 *
 * Hiding is reversible and nothing is deleted: `visible:false` + `hidden:true` (the two
 * are opposites, always written together) + `hidden_reason`, which is the flip-guard
 * that stops a later bulk "make PD works visible" sweep republishing them (#3099).
 *
 * `--withdraw-text` additionally moves the fabricated OCR and translation into
 * `page_revisions` and clears the fields, for the books that CANNOT be repaired from
 * ATF (the composite and the multi-surface monument). Otherwise the invention sits in
 * `ocr.data` waiting for whoever unhides the book next.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/hide-cdli-fabricated.mjs                       # dry run
 *   node scripts/maintenance/hide-cdli-fabricated.mjs --apply
 *   node scripts/maintenance/hide-cdli-fabricated.mjs --apply --withdraw-text
 *
 * After --apply, sync the Supabase mirror or the catalogue keeps serving them:
 *   node scripts/workers/sync-books-catalog.mjs
 */
import { MongoClient } from 'mongodb';
import { saveRevisionBeforeOverwrite } from '../lib/page-revisions.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';

const APPLY = process.argv.includes('--apply');
const WITHDRAW = process.argv.includes('--withdraw-text');
const REASON = 'fabricated_ocr_4851';

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const books = await db.collection('books').find({ 'image_source.provider': 'cdli' }).toArray();
  console.log(`${books.length} CDLI book(s)${APPLY ? '' : '  [DRY RUN]'}\n`);

  for (const book of books) {
    const repaired = book.image_source?.inscription_source === 'cdli-atf';
    console.log(`${book.slug}\n  visible=${book.visible} hidden=${book.hidden} reason=${book.hidden_reason ?? '-'} atf_repaired=${repaired}`);
    if (!APPLY) { console.log('  would hide (dry run)\n'); continue; }

    await db.collection('books').updateOne({ id: book.id }, {
      $set: {
        visible: false,
        hidden: true,
        hidden_reason: REASON,
        hidden_at: new Date(),
        // The Supabase mirror syncs incrementally on `updated_at`; without this bump
        // the catalogue keeps listing a book Mongo has already hidden.
        updated_at: new Date(),
      },
    });
    console.log('  hidden');

    if (WITHDRAW && !repaired) {
      const pages = await db.collection('pages').find({ book_id: book.id }).toArray();
      for (const p of pages) {
        if ((p.ocr?.data || '').length) await saveRevisionBeforeOverwrite(db, p.id, 'ocr', { reason: 'fabricated_cuneiform_withdrawn_4851' });
        if ((p.translation?.data || '').length) await saveRevisionBeforeOverwrite(db, p.id, 'translation', { reason: 'fabricated_cuneiform_withdrawn_4851' });
        await db.collection('pages').updateOne({ id: p.id }, { $set: { ocr: {}, translation: {}, updated_at: new Date() } });
      }
      // Counters derived, not assumed — the canonical module owns the definition
      // (tests/unit/page-counter-writers.test.ts, #4499).
      const [counts] = await db.collection('pages').aggregate(buildVisiblePageCountPipeline(book.id)).toArray();
      await db.collection('books').updateOne({ id: book.id }, {
        $set: { pages_ocr: counts?.with_ocr ?? 0, pages_translated: counts?.with_translation ?? 0 },
      });
      console.log(`  withdrew fabricated text on ${pages.length} page(s) — kept in page_revisions`);
    }
    console.log('');
  }

  const stillVisible = await db.collection('books').countDocuments({ 'image_source.provider': 'cdli', visible: true });
  console.log(`CDLI books still visible: ${stillVisible}`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
