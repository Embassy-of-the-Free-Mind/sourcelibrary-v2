/**
 * Materialize the legacy-disposition shim into `books.first_translation` (#3726).
 *
 * Half the badged corpus has no stored verdict: derive-from-evidence returns
 * null for their legacy-grade evidence ON PURPOSE (an unconfirmable prior-hint
 * can neither demote nor be promoted over), and the read path covers them by
 * synthesizing a weak shim from `translation_verification.disposition` at
 * runtime (resolveFirstTranslation). This script persists THAT EXACT synthesis
 * — same function, same output — so:
 *
 *   - stage 3 (the verdict layer) reaches ~100% of the badged corpus,
 *   - the catalog projection (`ft_verdict` etc.) covers every badged book,
 *   - the runtime fallback becomes redundant and can eventually retire.
 *
 * ZERO behavior change by construction: the stored object is what every reader
 * already computed on the fly. Resolver stays `tier1_catalog` and strength
 * `weak`, so the nightly reconcile's resolver gate still refuses to demote on
 * shim evidence, and cards still render the candidate register.
 *
 * Skips books that already carry a verdict object (never overwrites — the
 * nightly derive owns upgrades). Bumps `updated_at` so the 5-min catalog sync
 * mirrors the new columns (a synced-column write without it is inert).
 *
 * Usage:
 *   npx tsx scripts/maintenance/materialize-legacy-ft-shim.ts            # dry-run
 *   npx tsx scripts/maintenance/materialize-legacy-ft-shim.ts --apply
 *   npx tsx scripts/maintenance/materialize-legacy-ft-shim.ts --apply --all-books
 *     (default scope: badged+visible; --all-books covers any book with a
 *      recognized legacy disposition)
 */
import { MongoClient } from 'mongodb';
import { resolveFirstTranslation } from '@/lib/first-translation/derive';
import type { FirstTranslationBook } from '@/lib/first-translation/types';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all-books');

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI!);
  const books = client.db('bookstore').collection('books');

  const scope: Record<string, unknown> = {
    'first_translation.verdict': { $exists: false },
    'translation_verification.disposition': { $exists: true },
    ...(ALL ? {} : { is_first_translation: true, visible: true }),
  };

  const cursor = books.find(scope, {
    projection: {
      _id: 0, id: 1, title: 1, author: 1, language: 1, original_language: 1,
      first_translation: 1, visible: 1, pages_translated: 1,
      'translation_verification.disposition': 1,
      'translation_verification.translations_found': 1,
    },
  });

  let scanned = 0, materialized = 0, unresolvable = 0;
  const byVerdict: Record<string, number> = {};
  const now = new Date();

  for await (const doc of cursor) {
    scanned++;
    const ft = resolveFirstTranslation(doc as FirstTranslationBook);
    if (!ft) { unresolvable++; continue; }
    byVerdict[ft.verdict] = (byVerdict[ft.verdict] ?? 0) + 1;
    if (APPLY) {
      await books.updateOne(
        { id: doc.id, 'first_translation.verdict': { $exists: false } },
        {
          $set: {
            first_translation: { ...ft, resolved_at: now },
            'field_provenance.first_translation': {
              source: 'materialize-legacy-ft-shim',
              at: now,
            },
            updated_at: now,
          },
        },
      );
    }
    materialized++;
  }

  console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — scope: ${ALL ? 'all books with legacy disposition' : 'badged+visible'}`);
  console.log(`  scanned: ${scanned}  materialized: ${materialized}  unresolvable (no recognized disposition): ${unresolvable}`);
  console.log('  by verdict:', JSON.stringify(byVerdict));
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
