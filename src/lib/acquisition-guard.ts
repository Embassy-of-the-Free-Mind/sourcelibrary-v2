/**
 * The acquisition gate — one place where "should we import this?" is decided,
 * and where a NO is written down.
 *
 * WHY. Acquisition dedupe is a different problem from merging. At acquisition
 * time a false positive is cheap: we decline a book we may already hold, and
 * nothing is destroyed. The destructive case is a `duplicate_of` merge that
 * hides a real book — this module has nothing to do with that and never writes
 * `duplicate_of`. So the gate is deliberately NOT made stricter here. Two
 * things were wrong instead:
 *
 *   1. The gate did not always RUN. Ten API import routes call
 *      `checkDuplicate()`; ~35 `scripts/import/*-direct.mjs` insert straight
 *      into Mongo and never do. (The direct-insert pattern exists to dodge
 *      datacenter-IP 403s from some providers and cannot simply be deleted —
 *      hence `scripts/lib/acquire-book.mjs`, which wraps this policy for them.)
 *   2. Where it DID run, it lost races. Measured 2026-08-30 over the 139
 *      same-fingerprint groups in `books`: **80 of them (58%) have all their
 *      members created within 5 seconds of each other**, dozens within a single
 *      millisecond. `scripts/catalog-coverage/acquire-gap-batch.mjs` runs with
 *      `CONCURRENCY = 10`, and ten USTC works that resolve to the same scan all
 *      pass `checkDuplicate()` before any of them inserts. A check-then-insert
 *      is not a gate under concurrency; `claimFingerprints()` below makes the
 *      decision atomic.
 *
 * And a skip used to evaporate into a script's stdout. Every decision this gate
 * makes now lands in `dedup_skips` with the evidence that produced it, so a
 * false positive is a reviewable row instead of a silent non-event.
 *
 * WHAT READS THESE STORES (writing to a store a job reads is actuation, not
 * recording): nothing automated. `dedup_skips` and `acquisition_claims` are
 * read by `scripts/audit/duplicate-fingerprint-groups.mjs` and by humans. No
 * cron consumes them, and nothing here changes a book's visibility, deletes a
 * record, or writes `duplicate_of`. Deliberately kept OUT of
 * `dedup_shadow_decisions`, which an agreement audit computes percentages
 * over — mixing a second kind of row into it would corrupt that measurement.
 */

import type { Db } from 'mongodb';
import { checkDuplicate, sourceFingerprints, editionYear, type DedupCandidate, type DedupMatch } from './dedup';

/** Collection holding one row per declined (or deliberately allowed) acquisition. */
export const SKIP_COLLECTION = 'dedup_skips';
/** Collection holding one row per fingerprint an importer has taken responsibility for. */
export const CLAIM_COLLECTION = 'acquisition_claims';

/**
 * How long an unconfirmed claim blocks a retry. An import takes well under
 * three minutes; a claim still unconfirmed after this is an abandoned run, and
 * a later importer may take it over. This is what makes the claim ledger safe
 * WITHOUT a TTL index (this project does not do automated data retention): the
 * row is never deleted, only re-dated. After the window the real `books` row
 * exists anyway, so `checkDuplicate()` is the backstop.
 */
export const STALE_CLAIM_MS = 30 * 60 * 1000;

export type EvidenceStrength =
  /** Tier 1 or 3 fired — same digital object, by identifier. */
  | 'exact'
  /** Edition key matched and BOTH sides state a publication year. */
  | 'edition_key_full'
  /** Edition key matched but a year is missing on at least one side, so the
   *  decision rests on normalized title + surname alone. The reviewable case. */
  | 'edition_key_no_year'
  /** The retired title+author tier was the only thing that fired. */
  | 'title_author'
  /** Another importer holds this fingerprint right now. */
  | 'claim_race';

export interface AcquisitionContext {
  /** Who is asking — `api:mdz`, `script:iiif-direct-import`, … Free text, but
   *  keep it stable so the audit can group by it. */
  importer: string;
  /** The provider-native id or URL of the candidate, for the review row. */
  sourceIdentifier?: string | null;
  sourceUrl?: string | null;
}

export interface AcquisitionGateResult {
  /** True when the caller may proceed with the insert. */
  ok: boolean;
  reason?: 'duplicate' | 'claimed';
  matches: DedupMatch[];
  /** The fingerprint set computed for the candidate (claimed when `ok`). */
  fingerprints: string[];
  evidence?: EvidenceStrength;
  /** Human-readable reason, suitable for a 409 body. */
  message?: string;
}

/** Classify how strong the evidence behind a skip is. */
export function classifyEvidence(candidateYear: number | null, matches: DedupMatch[]): EvidenceStrength {
  if (matches.some((m) => m.matchType === 'source_fingerprint' || m.matchType === 'iiif_manifest')) return 'exact';
  const ek = matches.filter((m) => m.matchType === 'edition_key');
  if (ek.length > 0) {
    const bothYears = candidateYear != null && ek.some((m) => m.matchedYear != null);
    return bothYears ? 'edition_key_full' : 'edition_key_no_year';
  }
  return 'title_author';
}

/** Append one row to `dedup_skips`. Never throws — a logging failure must not
 *  change an import verdict. */
export async function recordDedupSkip(
  db: Db,
  candidate: DedupCandidate,
  matches: DedupMatch[],
  ctx: AcquisitionContext,
  extra: { evidence: EvidenceStrength; fingerprints: string[]; allowedDuplicate?: boolean }
): Promise<void> {
  try {
    const year = editionYear(candidate);
    await db.collection(SKIP_COLLECTION).insertOne({
      at: new Date(),
      importer: ctx.importer,
      /** false = the candidate was declined; true = a caller deliberately asked
       *  for a second copy and we recorded the decision anyway. */
      allowed_duplicate: extra.allowedDuplicate === true,
      evidence: extra.evidence,
      /** The 81% case, flagged for review rather than buried. */
      year_missing_one_side: extra.evidence === 'edition_key_no_year',
      tier: matches[0]?.matchType ?? extra.evidence,
      candidate: {
        title: String(candidate.title || '').slice(0, 300),
        author: String(candidate.author || '').slice(0, 200),
        year,
        published: candidate.published ? String(candidate.published).slice(0, 120) : null,
        source_identifier: ctx.sourceIdentifier ?? candidate.image_source?.identifier ?? null,
        source_url: ctx.sourceUrl ?? candidate.image_source?.source_url ?? candidate.image_source?.iiif_manifest ?? null,
        fingerprints: extra.fingerprints,
      },
      matched_book_id: matches[0]?.matchedBookId ?? null,
      matches: matches.slice(0, 10).map((m) => ({
        book_id: m.matchedBookId,
        title: m.matchedTitle,
        tier: m.matchType,
        confidence: m.confidence,
        visible: m.matchedVisible === true,
        collection: m.matchedCollection ?? 'books',
        year: m.matchedYear ?? null,
      })),
    });
  } catch {
    // A skip we failed to record is still a skip. Never fail the caller.
  }
}

type ClaimOutcome = 'claimed' | 'reclaimed' | 'held' | 'unavailable';

async function claimOne(db: Db, fp: string, ctx: AcquisitionContext): Promise<ClaimOutcome> {
  const coll = db.collection(CLAIM_COLLECTION);
  try {
    await coll.insertOne({ _id: fp as unknown as never, at: new Date(), importer: ctx.importer });
    return 'claimed';
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 11000) return 'unavailable'; // infrastructure problem — fail OPEN
    // Someone holds it. Take over only an abandoned, never-confirmed claim.
    try {
      const res = await coll.findOneAndUpdate(
        { _id: fp as unknown as never, book_id: { $exists: false }, at: { $lt: new Date(Date.now() - STALE_CLAIM_MS) } },
        { $set: { at: new Date(), importer: ctx.importer }, $inc: { takeovers: 1 } }
      );
      return res ? 'reclaimed' : 'held';
    } catch {
      return 'unavailable';
    }
  }
}

/**
 * Atomically take responsibility for a candidate's fingerprints.
 * Returns the fingerprint another importer holds, or null when we hold them all.
 *
 * Fails OPEN on an infrastructure error (an unreachable claim collection must
 * not stop imports) and CLOSED on a real duplicate-key (a definite signal).
 */
export async function claimFingerprints(
  db: Db,
  fingerprints: string[],
  ctx: AcquisitionContext
): Promise<string | null> {
  for (const fp of fingerprints) {
    const outcome = await claimOne(db, fp, ctx);
    if (outcome === 'held') return fp;
  }
  return null;
}

/** Record the book that a set of claims produced, so the claims stop being
 *  re-claimable and the ledger points at the row it created. Never throws. */
export async function confirmClaims(db: Db, fingerprints: string[], bookId: string): Promise<void> {
  if (fingerprints.length === 0) return;
  try {
    await db.collection(CLAIM_COLLECTION).updateMany(
      { _id: { $in: fingerprints as unknown as never[] } },
      { $set: { book_id: bookId, confirmed_at: new Date() } }
    );
  } catch {
    // Best effort — an unconfirmed claim simply becomes reclaimable later.
  }
}

/** Hand a claim back after a failed import, so a retry is not blocked. Only
 *  releases claims that were never confirmed. Never throws. */
export async function releaseClaims(db: Db, fingerprints: string[]): Promise<void> {
  if (fingerprints.length === 0) return;
  try {
    await db.collection(CLAIM_COLLECTION).updateMany(
      { _id: { $in: fingerprints as unknown as never[] }, book_id: { $exists: false } },
      { $set: { at: new Date(0), released: true } }
    );
  } catch {
    // Best effort.
  }
}

/**
 * Run the acquisition gate. Call this INSTEAD of a bare `checkDuplicate()` on
 * any path that is about to create a book.
 *
 * - `ok: true`  → proceed; the candidate's fingerprints are now claimed. Call
 *                 `confirmClaims()` after the insert (or `releaseClaims()` if
 *                 the import then fails).
 * - `ok: false` → do not import; a row is already in `dedup_skips`.
 *
 * `opts.allowDuplicate` is the explicit opt-out for the rare case where a
 * caller genuinely wants a second copy. It does not silence the record: the
 * decision is written with `allowed_duplicate: true` so a deliberate second
 * copy is as visible as a declined one.
 */
export async function acquisitionGate(
  db: Db,
  candidate: DedupCandidate,
  ctx: AcquisitionContext,
  opts: { allowDuplicate?: boolean; shadowLog?: boolean; claim?: boolean } = {}
): Promise<AcquisitionGateResult> {
  const fingerprints = sourceFingerprints(candidate);
  const dedup = await checkDuplicate(db, candidate, { shadowLog: opts.shadowLog });

  if (dedup.isDuplicate) {
    const evidence = classifyEvidence(editionYear(candidate), dedup.matches);
    await recordDedupSkip(db, candidate, dedup.matches, ctx, {
      evidence,
      fingerprints,
      allowedDuplicate: opts.allowDuplicate === true,
    });
    if (opts.allowDuplicate !== true) {
      const best = dedup.matches[0];
      return {
        ok: false,
        reason: 'duplicate',
        matches: dedup.matches,
        fingerprints,
        evidence,
        message: `Duplicate detected (${best.matchType}): matches "${best.matchedTitle}"`,
      };
    }
  }

  if (opts.claim === false) return { ok: true, matches: dedup.matches, fingerprints };

  const held = await claimFingerprints(db, fingerprints, ctx);
  if (held && opts.allowDuplicate !== true) {
    await recordDedupSkip(db, candidate, dedup.matches, ctx, { evidence: 'claim_race', fingerprints });
    return {
      ok: false,
      reason: 'claimed',
      matches: dedup.matches,
      fingerprints,
      evidence: 'claim_race',
      message: `Another importer is acquiring this source right now (${held})`,
    };
  }

  return { ok: true, matches: dedup.matches, fingerprints };
}
