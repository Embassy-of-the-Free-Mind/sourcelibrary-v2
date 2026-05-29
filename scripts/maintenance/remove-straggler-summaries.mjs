/**
 * Remove (reversibly) the live "About This Book" summary from "straggler" books:
 * visible books that have a summary but NO section-level index data, so the
 * cheap plain-encyclopedic rewrite (resynthesize-summaries.mjs) cannot improve
 * them. Per product decision: better no summary than a stale marketing-style
 * one, especially for scholarly credibility.
 *
 * REVERSIBLE: the current summary / reading_summary / book_indexes.bookSummary
 * are stashed into book.summary_removed before the live fields are cleared.
 * Run with --restore to put them back.
 *
 * The page (src/app/book/[id]/page.tsx) shows "No summary" only when ALL of
 *   book_indexes.bookSummary.brief, book.reading_summary.overview, book.summary.data
 * are empty, so all three are cleared.
 *
 * Safety: DRY-RUN by default. Prints the count and a sample. Pass --execute to
 * actually write. --visible-only is implied (stragglers are scoped to visible).
 *
 * Usage:
 *   node scripts/maintenance/remove-straggler-summaries.mjs            # dry-run, show count + sample
 *   node scripts/maintenance/remove-straggler-summaries.mjs --execute  # clear (reversible)
 *   node scripts/maintenance/remove-straggler-summaries.mjs --restore --execute
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const RESTORE = args.includes('--restore');
const INCLUDE_HIDDEN = args.includes('--include-hidden');
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const indexes = db.collection('book_indexes');

  if (RESTORE) {
    const toRestore = await books.find({ 'summary_removed.removed_at': { $exists: true } })
      .project({ id: 1, summary_removed: 1 }).toArray();
    console.log(`[restore] ${toRestore.length} books have stashed summaries`);
    if (!EXECUTE) { console.log('  (dry-run; pass --execute to restore)'); await client.close(); return; }
    let n = 0;
    for (const b of toRestore) {
      const r = b.summary_removed || {};
      await books.updateOne({ id: b.id }, {
        $set: { summary: r.summary ?? null, reading_summary: r.reading_summary ?? null },
        $unset: { summary_removed: '' },
      });
      if (r.bookSummary) await indexes.updateOne({ book_id: b.id }, { $set: { bookSummary: r.bookSummary } });
      if (++n % 200 === 0) console.log(`  restored ${n}/${toRestore.length}`);
    }
    console.log(`[restore] done=${n}`);
    await client.close();
    return;
  }

  // Cheap-eligible = has a book_indexes doc WITH section data. Stragglers are
  // the visible, summarized books that are NOT in that set.
  console.log('[straggler] building set of cheap-eligible book_ids (have sectionSummaries)...');
  const eligible = new Set(
    (await indexes.find({ 'sectionSummaries.0': { $exists: true } }).project({ book_id: 1, _id: 0 }).toArray())
      .map(d => d.book_id),
  );
  console.log(`  cheap-eligible: ${eligible.size}`);

  const baseMatch = { 'summary.data': { $type: 'string', $ne: '' } };
  if (!INCLUDE_HIDDEN) baseMatch.visible = true;
  const summarized = await books.find(baseMatch)
    .project({ id: 1, title: 1, display_title: 1, author: 1, summary_candidate: 1, _id: 0 }).toArray();

  // Straggler = summarized + visible + NOT cheap-eligible + not already being rewritten.
  const stragglers = summarized.filter(b =>
    !eligible.has(b.id) &&
    !['pending', 'approved'].includes(b.summary_candidate?.status),
  );

  console.log(`[straggler] summarized(${INCLUDE_HIDDEN ? 'all' : 'visible'})=${summarized.length} · stragglers to clear=${stragglers.length}`);
  console.log('  sample:');
  for (const b of stragglers.slice(0, 8)) console.log(`   - ${b.id} ${(b.title || '').slice(0, 55)} — ${b.author || ''}`);

  if (!EXECUTE) { console.log('\n  DRY-RUN. Pass --execute to clear these (reversible via --restore).'); await client.close(); return; }

  let n = 0;
  for (const b of stragglers) {
    const cur = await books.findOne({ id: b.id }, { projection: { summary: 1, reading_summary: 1 } });
    const idx = await indexes.findOne({ book_id: b.id }, { projection: { bookSummary: 1 } });
    await books.updateOne({ id: b.id }, { $set: {
      summary_removed: {
        summary: cur?.summary ?? null,
        reading_summary: cur?.reading_summary ?? null,
        bookSummary: idx?.bookSummary ?? null,
        removed_at: new Date(),
        reason: 'no-section-data-straggler',
      },
      'summary.data': '',
      'reading_summary.overview': '',
      'reading_summary.detailed': '',
    } });
    if (idx?.bookSummary) {
      await indexes.updateOne({ book_id: b.id }, { $set: { 'bookSummary.brief': '', 'bookSummary.abstract': '', 'bookSummary.detailed': '' } });
    }
    if (++n % 200 === 0) console.log(`  cleared ${n}/${stragglers.length}`);
  }
  console.log(`[straggler] cleared=${n} (reversible: --restore --execute)`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
