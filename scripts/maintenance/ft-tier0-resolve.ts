/**
 * Tier-0 catalog resolver — runs the deterministic catalog/work_id match
 * (`src/lib/first-translation/tier0-catalog.ts`) over the badged set and reports
 * the books for which we ALREADY hold a complete, same-language, guard-passing
 * prior English translation. These are over-claims the badge-setting cron never
 * caught because it never queried our own `translation_catalogs`.
 *
 * Dry-run by default. With --apply it writes ONLY the verdict (book.first_translation
 * = not_first) + appends the attempt — it does NOT flip is_first_translation. The
 * single-writer reconcile materializes the demote afterwards:
 *   npx tsx scripts/maintenance/reconcile-first-translation-flag.ts --apply
 * (gate on Derek's sign-off). This keeps the single-writer invariant (#2564).
 *
 * Only `completeness: complete` catalog rows can be decisive, so we load those
 * once (~hundreds) and match in memory — no per-book DB round-trip.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/maintenance/ft-tier0-resolve.ts            # dry-run report
 *   npx tsx scripts/maintenance/ft-tier0-resolve.ts --apply    # write verdicts (gated)
 */
import { getDb } from '@/lib/mongodb';
import { makeTier0Catalog, type CatalogPrior, type CatalogLookup } from '@/lib/first-translation/tier0-catalog';
import type { ResolvableBook } from '@/lib/first-translation/resolve';
import { appendAttempt } from '@/lib/first-translation/attempt-log';

const APPLY = process.argv.includes('--apply');
const LIMIT = parseInt(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0', 10);

const norm = (s?: string) =>
  (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const surnameOf = (author?: string) => {
  const a = norm(author);
  if (!a) return '';
  return a.includes(',') ? a.split(',')[0].trim() : a.split(' ').slice(-1)[0];
};
const tokens = (s?: string) => new Set(norm(s).split(' ').filter((t) => t.length > 3));
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const t of a) if (b.has(t)) n++;
  return n / Math.min(a.size, b.size);
}

async function main() {
  const db = await getDb();
  const books = db.collection('books');

  // Load decisive-eligible catalog rows once (only complete priors can defeat).
  const completeRows = await db.collection('translation_catalogs')
    .find({ completeness: 'complete' },
      { projection: { _id: 0, author_surname: 1, canonical_author_normalized: 1, canonical_work_normalized: 1, english_title: 1, english_title_normalized: 1, translator: 1, pub_year: 1, completeness: 1, source_language: 1, source_url: 1, source: 1 } })
    .toArray();
  // Index by author surname for O(1) candidate fetch.
  const bySurname = new Map<string, any[]>();
  for (const r of completeRows) {
    const sn = (r.author_surname && norm(r.author_surname)) || surnameOf(r.canonical_author_normalized);
    if (!sn) continue;
    (bySurname.get(sn) ?? bySurname.set(sn, []).get(sn)!).push(r);
  }
  console.log(`loaded ${completeRows.length} complete catalog rows, ${bySurname.size} distinct surnames`);

  const lookup: CatalogLookup = async (book) => {
    const sn = surnameOf(book.author);
    const rows = bySurname.get(sn);
    if (!rows) return [];
    const wt = tokens(book.title);
    const out: CatalogPrior[] = [];
    for (const r of rows) {
      // title overlap against the work key or the english title (coarse containment)
      const ov = Math.max(overlap(wt, tokens(r.canonical_work_normalized)), overlap(wt, tokens(r.english_title_normalized)));
      if (ov >= 0.6) {
        out.push({
          english_title: r.english_title, translator: r.translator, pub_year: r.pub_year,
          completeness: r.completeness, source_language: r.source_language, source_url: r.source_url,
          source: r.source, matched_by: 'author_title',
        });
      }
    }
    return out;
  };
  const tier0 = makeTier0Catalog(lookup);

  const query = { is_first_translation: true, visible: true, pages_translated: { $gt: 0 }, language: { $nin: [null, 'en', 'eng', 'English', 'english'] } };
  const cursor = books.find(query, { projection: { _id: 0, id: 1, title: 1, author: 1, language: 1, original_language: 1, work_id: 1 } });
  if (LIMIT) cursor.limit(LIMIT);

  const now = new Date().toISOString();
  let scanned = 0, hits = 0, applied = 0;
  const candidates: any[] = [];
  for await (const b of cursor) {
    scanned++;
    const book = b as ResolvableBook;
    const outcome = await tier0(book, { now });
    if (outcome.terminal && outcome.verdict) {
      hits++;
      const p = outcome.attempt.priors?.[0];
      candidates.push({ id: b.id, title: b.title, author: b.author, language: b.language, prior: p });
      if (APPLY) {
        await appendAttempt(db as any, outcome.attempt);
        await books.updateOne({ id: b.id }, { $set: { first_translation: { ...outcome.verdict, best_attempt_id: outcome.attempt.attempt_id } } });
        applied++;
      }
    }
  }

  console.log(`\nscanned ${scanned} badged-eligible books — Tier-0 decisive priors held: ${hits}`);
  for (const c of candidates.slice(0, 50)) {
    console.log(`  ${c.id} [${c.language}] ${(c.author || '').slice(0, 24)} — ${(c.title || '').slice(0, 44)}`);
    console.log(`      prior: ${(c.prior?.english_title || '').slice(0, 60)} (${c.prior?.translator || '?'}, ${c.prior?.pub_year || '?'}) ${c.prior?.source_url || ''}`);
  }
  if (APPLY) {
    console.log(`\nAPPLIED ${applied} not_first verdicts (verdict-only). Now run the reconcile to materialize the demotes:`);
    console.log('  npx tsx scripts/maintenance/reconcile-first-translation-flag.ts --apply');
  } else {
    console.log('\nDRY-RUN — no writes. Re-run with --apply after sign-off, then reconcile.');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
