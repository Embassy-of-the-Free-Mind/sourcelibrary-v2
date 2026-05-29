/**
 * Promote staged summary candidates (book.summary_candidate) to LIVE.
 *
 * Writes the candidate's brief/abstract/detailed to the fields the book page
 * actually reads, in precedence order:
 *   book_indexes.bookSummary.{brief,abstract,detailed}  (shown first)
 *   book.summary.data            (= brief)
 *   book.reading_summary.{overview=abstract, detailed}
 *
 * REVERSIBLE: the prior live values are stashed into summary_candidate.replaced
 * before overwrite. Run with --restore to roll every promoted book back.
 *
 * Cleans a junk leading ellipsis ("... Title is a treatise") that a handful of
 * candidates inherited from titles literally beginning with "...".
 *
 * Safety: DRY-RUN by default (prints count + samples). Pass --execute to write.
 *
 * Usage:
 *   node scripts/maintenance/promote-summaries.mjs                 # dry-run
 *   node scripts/maintenance/promote-summaries.mjs --execute       # promote
 *   node scripts/maintenance/promote-summaries.mjs --visible-only --execute
 *   node scripts/maintenance/promote-summaries.mjs --restore --execute
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const RESTORE = args.includes('--restore');
const VISIBLE_ONLY = args.includes('--visible-only');
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// Strip a junk leading ellipsis / leading dots (from titles that begin "...").
const clean = (s) => (s || '').replace(/^\s*(?:\.\.\.|…)\s*/, '').trim();

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const indexes = db.collection('book_indexes');

  if (RESTORE) {
    const toRestore = await books.find({ 'summary_candidate.status': 'promoted', 'summary_candidate.replaced': { $exists: true } })
      .project({ id: 1, 'summary_candidate.replaced': 1 }).toArray();
    console.log(`[restore] ${toRestore.length} promoted books have a stashed previous summary`);
    if (!EXECUTE) { console.log('  dry-run; pass --execute to restore'); await client.close(); return; }
    let n = 0;
    for (const b of toRestore) {
      const r = b.summary_candidate.replaced || {};
      await books.updateOne({ id: b.id }, {
        $set: { summary: r.summary ?? null, reading_summary: r.reading_summary ?? null, 'summary_candidate.status': 'pending' },
      });
      if (r.bookSummary) await indexes.updateOne({ book_id: b.id }, { $set: { bookSummary: r.bookSummary } });
      else await indexes.updateOne({ book_id: b.id }, { $unset: { bookSummary: '' } });
      if (++n % 250 === 0) console.log(`  restored ${n}/${toRestore.length}`);
    }
    console.log(`[restore] done=${n}`);
    await client.close();
    return;
  }

  const match = { 'summary_candidate.status': 'pending', 'summary_candidate.brief': { $type: 'string', $ne: '' } };
  if (VISIBLE_ONLY) match.visible = true;
  const targets = await books.find(match)
    .project({ id: 1, title: 1, summary: 1, reading_summary: 1, summary_candidate: 1 }).toArray();

  const dotty = targets.filter(t => /^\s*(?:\.\.\.|…)/.test(t.summary_candidate.brief)).length;
  console.log(`[promote] candidates to promote=${targets.length}${VISIBLE_ONLY ? ' (visible only)' : ''} · leading-ellipsis cleaned=${dotty}`);
  console.log('  samples:');
  for (const t of targets.slice(0, 5)) console.log(`   - ${clean(t.summary_candidate.brief).slice(0, 90)}`);

  if (!EXECUTE) { console.log('\n  DRY-RUN. Pass --execute to promote (reversible via --restore).'); await client.close(); return; }

  let n = 0, failed = 0;
  for (const b of targets) {
    try {
      const c = b.summary_candidate;
      const brief = clean(c.brief), abstract = clean(c.abstract), detailed = clean(c.detailed);
      if (!brief) { continue; }
      const idx = await indexes.findOne({ book_id: b.id }, { projection: { bookSummary: 1 } });
      const replaced = { summary: b.summary ?? null, reading_summary: b.reading_summary ?? null, bookSummary: idx?.bookSummary ?? null };

      await indexes.updateOne({ book_id: b.id }, { $set: { 'bookSummary.brief': brief, 'bookSummary.abstract': abstract, 'bookSummary.detailed': detailed } });
      await books.updateOne({ id: b.id }, { $set: {
        'summary.data': brief,
        'summary.generated_at': new Date(),
        'summary.model': c.model ?? null,
        'summary.prompt_version': c.prompt_version ?? null,
        'summary.source': 'ai-resynth-promoted',
        'reading_summary.overview': abstract,
        'reading_summary.detailed': detailed,
        'summary_candidate.status': 'promoted',
        'summary_candidate.promoted_at': new Date(),
        'summary_candidate.replaced': replaced,
      } });
      if (++n % 250 === 0) console.log(`  promoted ${n}/${targets.length}`);
    } catch (e) { failed++; console.error(`  ERR ${b.id}: ${e.message}`); }
  }
  console.log(`[promote] promoted=${n} failed=${failed} (reversible: --restore --execute)`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
