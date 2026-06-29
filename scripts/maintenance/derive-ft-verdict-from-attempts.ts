/**
 * Derive `book.first_translation` (graded verdict) from the accumulated attempt
 * ledger (issue #2564 / #2805). The bridge that makes the durable evidence
 * actionable: verdict = f(accumulated evidence).
 *
 * WRITES ONLY `book.first_translation` (the verdict object) on --apply. It NEVER
 * writes the public `is_first_translation` boolean — that stays a derived read,
 * materialized only by the sign-off-gated reconcile
 * (reconcile-first-translation-flag.ts). So this is one safe step short of the
 * public flip: it reports the downstream flag diff the reconcile WOULD produce,
 * for review, but does not produce it.
 *
 * Dry-run by default. Even --apply is non-public (the verdict feeds the badge
 * only once the separate reconcile runs).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/maintenance/derive-ft-verdict-from-attempts.ts                 # dry-run report
 *   npx tsx scripts/maintenance/derive-ft-verdict-from-attempts.ts --book-id ID    # one book
 *   npx tsx scripts/maintenance/derive-ft-verdict-from-attempts.ts --apply         # write verdicts (NOT the flag)
 */
import { getDb } from '@/lib/mongodb';
import { deriveVerdictFromAttempts } from '@/lib/first-translation/derive-from-evidence';
import { isFirstByVerdict, canPromoteToFirst } from '@/lib/first-translation/derive';
import { ATTEMPTS_COLLECTION, type FirstTranslationAttempt } from '@/lib/first-translation/attempt-log';
import type { FirstTranslation, FirstTranslationBook } from '@/lib/first-translation/types';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BOOK_ID = args.find((a) => a.startsWith('--book-id='))?.split('=')[1]
  ?? (args.includes('--book-id') ? args[args.indexOf('--book-id') + 1] : undefined);
const SAMPLE = parseInt(args.find((a) => a.startsWith('--sample='))?.split('=')[1] || '15', 10);

interface BookDoc extends FirstTranslationBook {
  _id: unknown;
  id?: string;
  title?: string;
  author?: string;
  language?: string;
  visible?: boolean;
  pages_translated?: number;
  is_first_translation?: boolean;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const db = await getDb();
  const attemptsCol = db.collection<FirstTranslationAttempt>(ATTEMPTS_COLLECTION);
  const books = db.collection<BookDoc>('books');

  // 1) Pull attempts grouped by book.
  const attemptQuery = BOOK_ID ? { book_id: BOOK_ID } : {};
  const byBook = new Map<string, FirstTranslationAttempt[]>();
  const cur = attemptsCol.find(attemptQuery);
  for await (const a of cur) {
    if (!a.book_id) continue;
    const arr = byBook.get(a.book_id) ?? [];
    arr.push(a);
    byBook.set(a.book_id, arr);
  }
  console.log(`Books with attempts on record: ${byBook.size}`);

  // 2) Fetch the books those attempts refer to (book_id = books.id, the string id).
  const ids = [...byBook.keys()];
  const bookById = new Map<string, BookDoc>();
  for (const part of chunk(ids, 5000)) {
    const docs = await books.find(
      { id: { $in: part } },
      { projection: {
        id: 1, title: 1, author: 1, language: 1, original_language: 1,
        visible: 1, pages_translated: 1,
        is_first_translation: 1, first_translation: 1,
        'translation_verification.disposition': 1,
      } },
    ).toArray();
    for (const d of docs) if (d.id) bookById.set(d.id, d);
  }

  // 3) Derive + classify.
  const stats = {
    derived: 0, no_verdict: 0, book_missing: 0,
    by_verdict: {} as Record<string, number>,
    new_verdict: 0, changed_verdict: 0, same_verdict: 0,
    would_demote: 0, would_promote: 0, blocked_promote: 0, no_flag_change: 0,
  };
  const writes: { _id: unknown; ft: FirstTranslation }[] = [];
  const demoteSamples: string[] = [];
  const promoteSamples: string[] = [];

  for (const [bookId, attempts] of byBook) {
    const book = bookById.get(bookId);
    if (!book) { stats.book_missing++; continue; }
    const ft = deriveVerdictFromAttempts(attempts, book);
    if (!ft) { stats.no_verdict++; continue; }
    stats.derived++;
    stats.by_verdict[ft.verdict] = (stats.by_verdict[ft.verdict] || 0) + 1;

    // Verdict delta vs what's already stored.
    const prev = book.first_translation?.verdict;
    if (!prev) stats.new_verdict++;
    else if (prev !== ft.verdict) stats.changed_verdict++;
    else stats.same_verdict++;

    // Downstream flag effect IF the reconcile then ran on this verdict.
    const synthetic: FirstTranslationBook = { ...book, first_translation: ft };
    const proposedFlag = isFirstByVerdict(synthetic);
    const currentFlag = book.is_first_translation === true;
    const desc = `  ${book.id} [${book.language ?? '?'}] ${(book.author ?? '').slice(0, 24)} — ${(book.title ?? '').slice(0, 44)} (${ft.verdict}/${ft.evidence_strength})`;
    if (proposedFlag && !currentFlag) {
      if (canPromoteToFirst(synthetic)) { stats.would_promote++; if (promoteSamples.length < SAMPLE) promoteSamples.push(desc); }
      else stats.blocked_promote++;
    } else if (!proposedFlag && currentFlag) {
      stats.would_demote++; if (demoteSamples.length < SAMPLE) demoteSamples.push(desc);
    } else {
      stats.no_flag_change++;
    }

    writes.push({ _id: book._id, ft });
  }

  // 4) Report.
  console.log(`\n=== derive-ft-verdict-from-attempts (${APPLY ? 'APPLY (verdict only)' : 'DRY-RUN'}) ===`);
  console.log(`verdicts derived: ${stats.derived}  (no-verdict/unverified: ${stats.no_verdict}, book missing: ${stats.book_missing})`);
  console.log('by verdict:', JSON.stringify(stats.by_verdict));
  console.log(`verdict delta vs stored: new=${stats.new_verdict} changed=${stats.changed_verdict} same=${stats.same_verdict}`);
  console.log('\nDownstream flag effect IF reconcile then ran (this script does NOT flip the flag):');
  console.log(`  would PROMOTE (evidence-backed): ${stats.would_promote}`);
  console.log(`  blocked promotions (weak/ungated, held): ${stats.blocked_promote}`);
  console.log(`  would DEMOTE: ${stats.would_demote}`);
  console.log(`  no flag change: ${stats.no_flag_change}`);
  if (promoteSamples.length) { console.log('\n  sample would-promote:'); promoteSamples.forEach((s) => console.log(s)); }
  if (demoteSamples.length) { console.log('\n  sample would-demote:'); demoteSamples.forEach((s) => console.log(s)); }

  if (!APPLY) {
    console.log('\nDRY-RUN — no writes. Re-run with --apply to write book.first_translation (verdict only; still NOT the public flag).');
    return;
  }

  // 5) Write path — ONLY book.first_translation. Never is_first_translation.
  const now = new Date().toISOString();
  let written = 0;
  for (const part of chunk(writes, 500)) {
    const ops = part.map((w) => ({
      updateOne: {
        filter: { _id: w._id as any },
        update: { $set: { first_translation: { ...w.ft, resolved_at: now } } },
      },
    }));
    const r = await books.bulkWrite(ops, { ordered: false });
    written += r.modifiedCount;
  }
  console.log(`\nAPPLIED — wrote ${written} book.first_translation verdicts. The public is_first_translation flag is UNCHANGED (run the reconcile, gated on sign-off, to materialize it).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
