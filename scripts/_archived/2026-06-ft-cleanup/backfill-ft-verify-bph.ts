/**
 * Backfill first-translation verification for BPH books
 *
 * Runs verifyFirstTranslation on BPH books that haven't been FT-verified yet.
 * This doesn't require OCR — it uses title/author/language to search catalogs.
 * Sets is_first_translation flag so these books get prioritized in the pipeline.
 *
 * Usage:
 *   npx tsx scripts/migration/backfill-ft-verify-bph.ts [--dry-run] [--limit=N]
 */

import { getDb } from '@/lib/mongodb';
import { verifyFirstTranslation } from '@/lib/verify-first-translation';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '100');

async function main() {
  const db = await getDb();

  console.log(`[FT-VERIFY-BPH] ${new Date().toISOString()} — limit=${LIMIT}, dry-run=${DRY_RUN}`);

  // Find BPH books that haven't been FT-verified, excluding English
  const books = await db.collection('books')
    .find({
      'image_source.provider': 'bph',
      pages_count: { $gt: 0 },
      'translation_verification.verified_at': { $exists: false },
      language: { $nin: ['English', 'english'] },
    })
    .sort({ pages_translated: -1 }) // most translated first
    .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, pages_count: 1, pages_translated: 1, 'pipeline_auto.status': 1 })
    .limit(LIMIT)
    .toArray();

  console.log(`Found ${books.length} unverified BPH books\n`);

  let verified = 0;
  let firstTranslations = 0;
  let errors = 0;

  for (const book of books) {
    const label = (book.display_title || book.title || 'Unknown').slice(0, 60);
    const lang = book.language || 'Unknown';
    const status = book.pipeline_auto?.status || 'none';

    if (DRY_RUN) {
      console.log(`  [DRY] ${label} (${lang}, ${status})`);
      continue;
    }

    try {
      const result = await verifyFirstTranslation(db, book.id);

      if (result.success && result.verification) {
        const disp = result.verification.disposition;
        const isFirst = result.isFirstTranslation;
        verified++;
        if (isFirst) firstTranslations++;

        const marker = isFirst ? '★' : ' ';
        console.log(`  ${marker} ${label} → ${disp} (${result.verification.confidence})`);
      } else {
        console.log(`  ? ${label} → failed: ${result.error}`);
        errors++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ! ${label} → error: ${msg.slice(0, 100)}`);
      errors++;

      // Rate limit — back off
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        console.log('  Rate limited — waiting 15s...');
        await new Promise(r => setTimeout(r, 15000));
      }
    }
  }

  console.log(`\n[FT-VERIFY-BPH] Done — ${verified} verified, ${firstTranslations} first translations, ${errors} errors`);
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
