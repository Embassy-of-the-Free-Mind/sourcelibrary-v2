/**
 * Ingest Tier-2 adjudicator verdicts into the provenance log (issue #2564).
 *
 * Reads the adjudicator output (a `.json` array OR the `.jsonl` evidence
 * sidecar from ft-gemini-adjudicate.mjs — structured verdict + grounded search
 * trail + priors found, per book) and:
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
  queries?: string[];
  reasoning?: string;
  confidence?: string;
  model?: string;
  cost_usd?: number;
}

/** Accept both the consolidated `.json` array and the `.jsonl` evidence sidecar. */
function readVerdicts(path: string): Verdict[] {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  if (raw[0] === '[') return JSON.parse(raw);
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const verdicts: Verdict[] = readVerdicts(file);
  const db = await getDb();
  const now = new Date().toISOString();

  let attemptsWritten = 0;
  const proposed: Array<{ id: string; verdict: string; was: string; firstFamily: boolean }> = [];

  for (const v of verdicts) {
    const priors = v.prior_translations_found ?? [];
    const found = priors.length > 0;
    // Human-readable prior identity (translator/year/title). Lives in `notes`
    // until the #2453 registry exists to give priors stable ids for found_refs.
    const priorStr = priors
      .map((p) => `${p.translator ?? '?'} ${p.pub_year ?? '?'} "${p.english_title ?? '?'}"`)
      .join('; ');
    const attempt = {
      attempt_id: makeAttemptId(v.book_id, 'gemini_verifier', now),
      book_id: v.book_id,
      date: now,
      method: 'gemini_verifier' as const, // AttemptMethod superset (not a Resolver)
      match_key: v.match_key,
      sources_checked: v.sources_checked ?? [], // best-effort (often sparse on true negatives)
      queries: v.queries ?? [], // the actual searches issued — load-bearing absence evidence
      result: (found ? 'found' : 'none') as 'found' | 'none',
      found_refs: [], // registry ids assigned when #2453 registry exists
      priors: priors.map((p) => ({          // structured, for per-book consumers (badge panel, work-linking)
        english_title: p.english_title,
        translator: p.translator,
        pub_year: p.pub_year,
        publisher: p.publisher,
        completeness: p.completeness,
        source_url: p.source_url,
      })),
      evidence_strength: v.evidence_strength,
      model: v.model,
      cost_usd: v.cost_usd,
      notes: `${v.work_identified ? `[${v.work_identified}] ` : ''}${v.reasoning ?? ''}${priorStr ? ` | priors: ${priorStr}` : ''}`.trim(),
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
            resolver: 'tier2_agent', // the enum IS the tier-2 instrument (gemini_verifier is a method, not a Resolver)
            best_attempt_id: makeAttemptId(v.book_id, 'gemini_verifier', now),
            resolved_at: now,
          },
        } },
      );
      written += r.modifiedCount;
    }
    console.log(`\n--apply-verdicts: wrote book.first_translation on ${written} books (flag NOT auto-flipped; run reconcile-first-translation-flag.ts [RETIRED #4536: the badge is card-governed now — propose a Translation Card edit instead] to materialize).`);
  } else {
    console.log('\n(verdicts NOT applied to books — re-run with --apply-verdicts after sign-off)');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
