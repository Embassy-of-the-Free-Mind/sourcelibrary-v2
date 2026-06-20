/**
 * Reconcile the stored `is_first_translation` boolean to the DERIVED rule
 * (issue #2564). Single-writer: this is the ONLY job that writes the flag.
 *
 * For every book that either carries the flag OR has a disposition, it computes
 * isFirstByVerdict() from src/lib/first-translation (the one source of truth)
 * and reports/writes the mismatch. The flag becomes a materialized read of the
 * graded verdict — no more drift between the boolean and the disposition.
 *
 * Dry-run by default. WRITES ONLY with --apply (gate on Derek's sign-off).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/maintenance/reconcile-first-translation-flag.ts            # dry-run, full report
 *   npx tsx scripts/maintenance/reconcile-first-translation-flag.ts --only-demotions   # just flag:true -> derived:false
 *   npx tsx scripts/maintenance/reconcile-first-translation-flag.ts --apply    # WRITE (asks nothing — be sure)
 */
import { getDb } from '@/lib/mongodb';
import { isFirstByVerdict, firstTranslationVerdict, canPromoteToFirst } from '@/lib/first-translation/derive';
import type { FirstTranslationBook } from '@/lib/first-translation/types';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY_DEMOTIONS = args.includes('--only-demotions');
const SAMPLE = parseInt(args.find((a) => a.startsWith('--sample='))?.split('=')[1] || '0', 10);
/** Restrict the demotion write to books whose derived verdict is one of these. */
const VERDICT_FILTER = (args.find((a) => a.startsWith('--verdict='))?.split('=')[1] || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

interface BookDoc extends FirstTranslationBook {
  _id: unknown;
  id?: string;
  title?: string;
  author?: string;
  language?: string;
  is_first_translation?: boolean;
}

async function main() {
  const db = await getDb();
  const books = db.collection<BookDoc>('books');

  // Any book the flag could apply to: currently flagged, or carrying a verdict
  // /disposition that the derived rule reads.
  const query = {
    $or: [
      { is_first_translation: true },
      { 'translation_verification.disposition': { $exists: true } },
      { 'first_translation.verdict': { $exists: true } },
    ],
  };

  const cursor = books.find(query, {
    projection: {
      id: 1, title: 1, author: 1, language: 1, visible: 1, pages_translated: 1,
      is_first_translation: 1, 'translation_verification.disposition': 1,
      'translation_verification.source': 1, first_translation: 1,
    },
  });

  let scanned = 0;
  const demotions: BookDoc[] = []; // flag:true but derived:false
  const promotions: BookDoc[] = []; // flag:false/absent AND evidence-backed first
  const blockedPromotions: BookDoc[] = []; // first-by-verdict but NOT evidence-backed (hygiene gate)
  const demotionReasons: Record<string, number> = {};

  for await (const b of cursor) {
    scanned++;
    const stored = b.is_first_translation === true;
    const derived = isFirstByVerdict(b);
    if (stored && !derived) {
      demotions.push(b);
      const v = firstTranslationVerdict(b) ?? 'no-verdict';
      demotionReasons[v] = (demotionReasons[v] || 0) + 1;
    } else if (!stored && derived) {
      // Bidirectional hygiene gate (#2564): only promote on real evidence, not
      // a stale `confirmed_first` shim — disposition is ~53% wrong, so blind
      // promotion injects false positives. canPromoteToFirst requires a stored
      // verdict from a real adjudicator with non-weak evidence.
      if (canPromoteToFirst(b)) promotions.push(b);
      else blockedPromotions.push(b);
    }
  }

  const desc = (b: BookDoc) =>
    `  ${b.id ?? b._id}  [${b.language ?? '?'}] ${(b.author ?? '').slice(0, 28)} — ${(b.title ?? '').slice(0, 50)} (disp=${b.translation_verification?.disposition ?? '–'})`;

  console.log(`\n=== reconcile-first-translation-flag (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`scanned: ${scanned}`);
  console.log(`\nDEMOTIONS (flag:true -> derived:false): ${demotions.length}`);
  console.log('  by current verdict:', JSON.stringify(demotionReasons));
  for (const b of demotions.slice(0, SAMPLE || 40)) console.log(desc(b));
  if (demotions.length > (SAMPLE || 40)) console.log(`  …and ${demotions.length - (SAMPLE || 40)} more`);

  if (!ONLY_DEMOTIONS) {
    console.log(`\nPROMOTIONS (evidence-backed, flag:false/absent -> first): ${promotions.length}`);
    for (const b of promotions.slice(0, SAMPLE || 20)) console.log(desc(b));
    if (promotions.length > (SAMPLE || 20)) console.log(`  …and ${promotions.length - (SAMPLE || 20)} more`);
    console.log(`\nBLOCKED promotions (first-by-verdict but NOT evidence-backed — hygiene gate held): ${blockedPromotions.length}`);
    console.log('  (these need a real Tier-1/Tier-2 adjudication before promotion; not written)');
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — no writes. Re-run with --apply after sign-off.');
    return;
  }

  // ── WRITE PATH (single writer) ─────────────────────────────────────────
  // When --verdict is given, restrict the write to that bucket (and skip
  // promotions) — e.g. --verdict=not_first writes only the unambiguous demotions.
  const demoteSet = VERDICT_FILTER.length
    ? demotions.filter((b) => VERDICT_FILTER.includes(firstTranslationVerdict(b) ?? 'no-verdict'))
    : demotions;
  if (VERDICT_FILTER.length) {
    console.log(`\n--verdict filter ${JSON.stringify(VERDICT_FILTER)} -> writing ${demoteSet.length} of ${demotions.length} demotions`);
  }
  const toDemote = demoteSet.map((b) => b._id);
  const toPromote = (ONLY_DEMOTIONS || VERDICT_FILTER.length) ? [] : promotions.map((b) => b._id);
  let demoted = 0, promoted = 0;
  if (toDemote.length) {
    const r = await books.updateMany({ _id: { $in: toDemote as any[] } }, { $set: { is_first_translation: false } });
    demoted = r.modifiedCount;
  }
  if (toPromote.length) {
    const r = await books.updateMany({ _id: { $in: toPromote as any[] } }, { $set: { is_first_translation: true } });
    promoted = r.modifiedCount;
  }
  console.log(`\nAPPLIED — demoted: ${demoted}, promoted: ${promoted}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
