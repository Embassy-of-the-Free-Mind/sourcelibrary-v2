/**
 * Backfill legacy per-book FT evidence into the canonical append-only log.
 *
 * Durability principle (#2564 / #2780): the verification *approach* changes, but
 * the evidence must persist and be readable by every future approach. For most
 * of the project, evidence was written into the per-book `books.translation_verification`
 * field — 12,809 books, 4,244 with tool trails, 2,983 with found priors — which
 * `prior-evidence.ts` / the new resolver CANNOT see. Only ~1,779 of those books
 * have a row in `first_translation_attempts`. This migrates the rest.
 *
 * Append-only + idempotent + $0:
 *  - writes ONLY to first_translation_attempts (one row per legacy disposition),
 *    never touches is_first_translation, book.first_translation, or any verdict.
 *  - idempotent: deterministic attempt_id `${book_id}:legacy_tv:${date}` with
 *    upsert + $setOnInsert — re-running never duplicates or overwrites.
 *  - reversible: every migrated row is method=gemini_verifier AND notes start
 *    with "[legacy_tv]" — delete by that tag to undo.
 *  - no model calls; pure data move.
 *
 *   npx tsx scripts/maintenance/backfill-ft-attempts-from-verification.ts            # dry-run
 *   npx tsx scripts/maintenance/backfill-ft-attempts-from-verification.ts --apply
 */
import { getDb } from '@/lib/mongodb';
import { ATTEMPTS_COLLECTION, type FirstTranslationAttempt, type PriorTranslation } from '@/lib/first-translation/attempt-log';

const APPLY = process.argv.includes('--apply');
const FALLBACK_DATE = '2026-06-01T00:00:00Z';

function toIso(v: unknown): string {
  if (!v) return FALLBACK_DATE;
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  const d = new Date(s);
  return isNaN(d.getTime()) ? FALLBACK_DATE : d.toISOString();
}

function mapPrior(p: any): PriorTranslation {
  return {
    english_title: p?.english_title ?? p?.title,
    translator: p?.translator,
    pub_year: p?.pub_year ?? p?.year,
    publisher: p?.publisher,
    completeness: p?.completeness,
    source_url: p?.url ?? p?.source_url ?? undefined,
  };
}

async function main() {
  const db = await getDb();
  const books = db.collection('books');
  const attempts = db.collection<FirstTranslationAttempt>(ATTEMPTS_COLLECTION);

  const cursor = books.find(
    { 'translation_verification.disposition': { $exists: true } },
    { projection: { id: 1, 'translation_verification': 1 } },
  );

  let scanned = 0, built = 0, skippedNoId = 0;
  let ops: any[] = [];
  let inserted = 0, alreadyPresent = 0;
  const BATCH = 1000;

  async function flush() {
    if (!ops.length) return;
    if (APPLY) {
      const r = await attempts.bulkWrite(ops, { ordered: false });
      inserted += r.upsertedCount;
      alreadyPresent += ops.length - r.upsertedCount;
    }
    ops = [];
  }

  for await (const b of cursor as any) {
    scanned++;
    const bookId = b.id ?? (b._id ? String(b._id) : null);
    if (!bookId) { skippedNoId++; continue; }
    const tv = b.translation_verification || {};
    const isoDate = toIso(tv.verified_at);
    const attempt_id = `${bookId}:legacy_tv:${isoDate}`;
    const priorsRaw = Array.isArray(tv.translations_found) ? tv.translations_found
      : Array.isArray(tv.validated_translations) ? tv.validated_translations : [];
    const priors = priorsRaw.map(mapPrior).filter((p: PriorTranslation) => p.english_title);
    const result: 'found' | 'none' = priors.length > 0 ? 'found' : 'none';

    const doc: FirstTranslationAttempt = {
      attempt_id,
      book_id: bookId,
      date: isoDate,
      method: 'gemini_verifier',
      match_key: 'none',
      sources_checked: Array.isArray(tv.tools_called) ? tv.tools_called : [],
      queries: [], // legacy did not store queries
      result,
      priors,
      evidence_strength: 'weak', // all legacy claims are weak until re-resolved
      independence_score: 0.3,
      model: tv.model,
      cost_usd: tv.cost_usd,
      notes: `[legacy_tv] disposition=${tv.disposition}; ${(tv.reasoning || '').slice(0, 500)}`,
    };
    built++;
    ops.push({ updateOne: { filter: { attempt_id }, update: { $setOnInsert: doc }, upsert: true } });

    // LLM *knowledge* guesses are the weakest evidence tier — unverified model
    // belief, not a grounded sighting. They are still evidence (a hint of a prior
    // to verify, or a soft absence signal), so preserve them — but as a DISTINCT,
    // lowest-strength attempt with no URL, so prior-evidence never treats them as
    // a reusable found-prior or a trustworthy absence. (Derek: "even llm guesses
    // serve as a type of evidence.")
    const llmRaw = Array.isArray(tv.llm_knowledge_translations) ? tv.llm_knowledge_translations : [];
    const llmPriors = llmRaw.map(mapPrior).filter((p: PriorTranslation) => p.english_title)
      .map((p: PriorTranslation) => ({ ...p, source_url: undefined })); // never URL-backed → never reusable presence
    if (llmPriors.length) {
      const llmId = `${bookId}:legacy_llm:${isoDate}`;
      ops.push({ updateOne: { filter: { attempt_id: llmId }, update: { $setOnInsert: {
        attempt_id: llmId, book_id: bookId, date: isoDate, method: 'gemini_verifier', match_key: 'none',
        sources_checked: [], queries: [], result: 'found', priors: llmPriors,
        evidence_strength: 'weak', independence_score: 0.1, model: tv.model,
        notes: `[legacy_llm] unverified model knowledge (${llmPriors.length} guessed prior${llmPriors.length === 1 ? '' : 's'}); not a grounded sighting`,
      } as FirstTranslationAttempt }, upsert: true } });
    }
    if (ops.length >= BATCH) await flush();
  }
  await flush();

  console.log(`scanned ${scanned} | built ${built} | skipped(no id) ${skippedNoId}`);
  if (APPLY) console.log(`APPLIED — inserted ${inserted} new attempt rows; ${alreadyPresent} already present (idempotent skip)`);
  else console.log(`DRY-RUN — would upsert ${built} rows (existing ones are no-ops). Re-run with --apply.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
