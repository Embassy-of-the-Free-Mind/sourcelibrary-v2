/**
 * Ingest Tier-2 adjudicator verdicts into the provenance log (issue #2564).
 *
 * Reads a JSON array of adjudicator outputs (the structured verdict + sources
 * each per-book agent returns) and:
 *   1. APPENDS one attempt per book to `first_translation_attempts` (safe —
 *      new, append-only collection; this is the evidence-of-absence record).
 *   2. REPORTS the proposed book.first_translation verdict changes WITHOUT
 *      writing them (public bibliographic claim — gated on sign-off; pass
 *      --apply-verdicts to materialize once approved).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/ft-ingest-verdicts.ts <verdicts.json> [--apply-verdicts]
 */
import { readFileSync } from 'fs';
import { getDb } from '@/lib/mongodb';
import { appendAttempt, makeAttemptId } from '@/lib/first-translation/attempt-log';
import { FIRST_FAMILY } from '@/lib/first-translation/types';

const file = process.argv[2];
const APPLY_VERDICTS = process.argv.includes('--apply-verdicts');
if (!file) { console.error('usage: ft-ingest-verdicts.ts <verdicts.json> [--apply-verdicts]'); process.exit(1); }

interface Verdict {
  book_id: string;
  work_identified?: string;
  verdict: string;
  prior_relationship?: string | null;
  evidence_strength: 'strong' | 'moderate' | 'weak';
  our_completeness: 'complete' | 'partial' | 'unknown';
  match_key: 'work_id' | 'author_title' | 'transliteration' | 'none';
  prior_translations_found?: Array<Record<string, string>>;
  sources_checked?: string[];
  reasoning?: string;
  confidence?: string;
}

async function main() {
  const verdicts: Verdict[] = JSON.parse(readFileSync(file, 'utf8'));
  const db = await getDb();
  const now = new Date().toISOString();

  let attemptsWritten = 0;
  const proposed: Array<{ id: string; verdict: string; was: string; firstFamily: boolean }> = [];

  for (const v of verdicts) {
    const found = (v.prior_translations_found ?? []).length > 0;
    const attempt = {
      attempt_id: makeAttemptId(v.book_id, 'tier2_agent', now),
      book_id: v.book_id,
      date: now,
      method: 'tier2_agent' as const,
      match_key: v.match_key,
      sources_checked: v.sources_checked ?? [],
      result: (found ? 'found' : 'none') as 'found' | 'none',
      found_refs: [], // registry ids assigned when #2453 registry exists
      evidence_strength: v.evidence_strength,
      notes: `${v.work_identified ? `[${v.work_identified}] ` : ''}${v.reasoning ?? ''}`.trim(),
    };
    await appendAttempt(db as any, attempt);
    attemptsWritten++;

    // Read current stored flag for the diff report.
    const cur = await db.collection('books').findOne(
      { id: v.book_id },
      { projection: { is_first_translation: 1 } },
    );
    proposed.push({
      id: v.book_id,
      verdict: v.verdict,
      was: cur?.is_first_translation ? 'flagged-first' : 'not-flagged',
      firstFamily: FIRST_FAMILY.has(v.verdict as any),
    });
  }

  console.log(`\nAttempts appended to first_translation_attempts: ${attemptsWritten}`);
  console.log('\nProposed verdicts (book.first_translation NOT written without --apply-verdicts):');
  for (const p of proposed) {
    const action = p.firstFamily ? 'KEEP/BADGE' : 'DEMOTE';
    console.log(`  ${p.id}  ${p.verdict.padEnd(16)} [${p.was}] -> ${action}`);
  }

  if (APPLY_VERDICTS) {
    let written = 0;
    for (const v of verdicts) {
      const r = await db.collection('books').updateOne(
        { id: v.book_id },
        { $set: {
          first_translation: {
            verdict: v.verdict,
            evidence_strength: v.evidence_strength,
            our_completeness: v.our_completeness,
            match_key: v.match_key,
            prior_relationship: v.prior_relationship || undefined,
            resolver: 'tier2_agent',
            best_attempt_id: makeAttemptId(v.book_id, 'tier2_agent', now),
            resolved_at: now,
          },
        } },
      );
      written += r.modifiedCount;
    }
    console.log(`\n--apply-verdicts: wrote book.first_translation on ${written} books (flag NOT auto-flipped; run reconcile-first-translation-flag.ts to materialize).`);
  } else {
    console.log('\n(verdicts NOT applied to books — re-run with --apply-verdicts after sign-off)');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
