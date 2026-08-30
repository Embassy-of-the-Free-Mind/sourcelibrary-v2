/**
 * ft-rung3-queue.ts — build the rung-3 (Claude ft-verify) worklist from the
 * LEDGER, not from per-run report files (#3881 pass 2).
 *
 * The per-run `ft-ladder-rung3-queue-<date>.json` files overwrite each other
 * and go stale the moment another run happens — the 2026-08-10 run briefly
 * left a version polluted with 1,749 quota-error books. The ledger
 * (`first_translation_attempts`) plus the books collection can answer the
 * queue question at any moment, so this builder IS the queue; the ladder's
 * JSON output is a run report, not an input to anything.
 *
 * Buckets, in verification-priority order (all recomputed, none read from
 * report files):
 *
 *   demote_candidate     a skeptic search found a COMPLETE prior against a live
 *                        badge — only rung 3+ may earn the resolver that moves
 *                        the badge, so these verify first.
 *   uncertain            the skeptic could not decide.
 *   needs_review         the stored verdict itself demands adjudication
 *                        (remember: needs_review DEMOTES at reconcile).
 *   hard_class           pre-search structural signals (container, liturgy,
 *                        archival document …) — recomputed via the same screen
 *                        the ladder uses; these books have no useful skeptic row
 *                        by design.
 *   undocumented_absence a "none found" whose search trail is below the
 *                        documented bar (<3 queries or <2 sources) — absence
 *                        that still needs a real search behind it.
 *
 * Books already resolved by the badge-moving tier (resolver tier2_agent or
 * human) are excluded — re-verifying them is duplicate spend.
 *
 * Read-only. Writes nothing to Mongo.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/ft-rung3-queue.ts                  # summary + counts
 *   npx tsx scripts/eval/ft-rung3-queue.ts --out=queue.json # full worklist
 *   npx tsx scripts/eval/ft-rung3-queue.ts --bucket=demote_candidate --out=demotes.json
 */
import fs from 'fs';
import { getDb } from '@/lib/mongodb';
import type { FirstTranslationAttempt } from '@/lib/first-translation/attempt-log';
// @ts-expect-error — plain .mjs module without type declarations (tsx resolves it)
import { screenDemoteCandidate } from '../lib/ft-demote-screen.mjs';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const OUT = arg('out');
const BUCKET = arg('bucket');

/** The skeptic's own "documented search" bar (skeptic.ts): ≥3 queries AND ≥2 sources. */
const documented = (a: FirstTranslationAttempt) =>
  (a.queries?.length ?? 0) >= 3 && (a.sources_checked?.length ?? 0) >= 2;

interface QueueRow {
  book_id: string;
  work?: string;
  author?: string;
  lang?: string;
  bucket: 'demote_candidate' | 'uncertain' | 'needs_review' | 'hard_class' | 'undocumented_absence';
  reasons: string[];
  claimed_priors?: FirstTranslationAttempt['priors'];
  transcript_ref?: string;
}

async function main() {
  const db = await getDb();
  const books = db.collection('books');
  const attemptsCol = db.collection<FirstTranslationAttempt>('first_translation_attempts');

  // Scope: the badged-weak universe plus stored needs_review — the books whose
  // public claim is not yet evidence-backed.
  const scope = await books.find(
    {
      visible: true,
      language: { $nin: [null, 'en', 'eng', 'English', 'english'] },
      $or: [
        { is_first_translation: true },
        { 'first_translation.verdict': 'needs_review' },
      ],
    },
    { projection: { _id: 0, id: 1, title: 1, author: 1, language: 1, first_translation: 1, translation_verification: 1 } },
  ).toArray();

  const rows: QueueRow[] = [];
  const counts: Record<string, number> = {};
  const push = (r: QueueRow) => {
    rows.push(r);
    counts[r.bucket] = (counts[r.bucket] ?? 0) + 1;
  };

  for (const b of scope) {
    const ft = b.first_translation as { resolver?: string; verdict?: string; evidence_strength?: string } | undefined;
    // Already resolved by the badge-moving tier — do not re-pay.
    if (ft?.resolver === 'tier2_agent' || ft?.resolver === 'human') continue;

    const base = { book_id: b.id as string, work: b.title as string, author: b.author as string, lang: b.language as string };

    // Pre-search hard classes never get a useful skeptic row by design.
    const screen = screenDemoteCandidate(b) as { signals: Array<{ code: string }> };
    const hardSignals = (screen.signals ?? []).map((s) => s.code);
    if (hardSignals.length) {
      push({ ...base, bucket: 'hard_class', reasons: hardSignals });
      continue;
    }

    const attempts = await attemptsCol
      .find({ book_id: b.id as string, prompt_version: { $regex: 'skeptic' } })
      .sort({ date: -1 })
      .limit(5)
      .toArray();
    const latest = attempts[0];

    const demote = attempts.find((a) => a.verdict === 'complete_prior_found');
    if (demote) {
      push({ ...base, bucket: 'demote_candidate', reasons: ['complete_prior_found_needs_tier2'], claimed_priors: demote.priors, transcript_ref: demote.transcript_ref });
      continue;
    }
    if (latest?.verdict === 'uncertain') {
      push({ ...base, bucket: 'uncertain', reasons: ['rung2_uncertain'], transcript_ref: latest.transcript_ref });
      continue;
    }
    if (ft?.verdict === 'needs_review') {
      push({ ...base, bucket: 'needs_review', reasons: ['stored_verdict_needs_review'], transcript_ref: latest?.transcript_ref });
      continue;
    }
    if (latest && latest.result === 'none' && !documented(latest)) {
      push({ ...base, bucket: 'undocumented_absence', reasons: ['absence_below_documented_bar'], transcript_ref: latest.transcript_ref });
    }
    // A documented absence needs no rung-3 visit: the evidence is honest and on file.
  }

  const order: QueueRow['bucket'][] = ['demote_candidate', 'uncertain', 'needs_review', 'hard_class', 'undocumented_absence'];
  rows.sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket) || a.book_id.localeCompare(b.book_id));
  const out = BUCKET ? rows.filter((r) => r.bucket === BUCKET) : rows;

  console.log(`rung-3 queue (from the ledger, ${new Date().toISOString()}):`);
  for (const k of order) console.log(`  ${k.padEnd(22)} ${String(counts[k] ?? 0).padStart(5)}`);
  console.log(`  total ${rows.length}${BUCKET ? ` | emitted bucket=${BUCKET}: ${out.length}` : ''}`);

  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), counts, rows: out }, null, 1));
    console.log(`Wrote ${OUT}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
