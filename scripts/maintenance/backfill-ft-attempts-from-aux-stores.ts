/**
 * Backfill the OTHER scattered FT evidence stores into the canonical log (#2780).
 *
 * Beyond books.translation_verification (already migrated by
 * backfill-ft-attempts-from-verification.ts), FT evidence was logged in several
 * more places that prior-evidence.ts / the resolver never read:
 *   - translation_classification (9,906 docs): per-book classification +
 *     a named known_translation string + reasoning.
 *   - ai_metadata.first_translation (15,285 books): status + reasoning +
 *     known_translations[] (title strings).
 *   - ft_reverify_proposal (2,729 docs): verdict + catalog_counts +
 *     STRUCTURED translations[] + reasoning.
 *
 * Append-only + idempotent + $0: one row per source per book, deterministic
 * attempt_id with a source tag ([legacy_tc]/[legacy_ai]/[legacy_rp] in notes),
 * upsert $setOnInsert. All method=gemini_verifier (they ARE gemini-family AI
 * outputs) so they stay correctly CORRELATED — they never inflate
 * independentAbsenceMethods. Writes ONLY first_translation_attempts; no verdict
 * or flag change. Reversible by the note tag.
 *
 *   npx tsx scripts/maintenance/backfill-ft-attempts-from-aux-stores.ts            # dry-run
 *   npx tsx scripts/maintenance/backfill-ft-attempts-from-aux-stores.ts --apply
 */
import { getDb } from '@/lib/mongodb';
import { ATTEMPTS_COLLECTION, type FirstTranslationAttempt, type PriorTranslation } from '@/lib/first-translation/attempt-log';

const APPLY = process.argv.includes('--apply');
const FALLBACK_DATE = '2026-06-01T00:00:00Z';
const toIso = (v: unknown): string => {
  if (!v) return FALLBACK_DATE;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? FALLBACK_DATE : d.toISOString();
};

async function run() {
  const db = await getDb();
  const attempts = db.collection<FirstTranslationAttempt>(ATTEMPTS_COLLECTION);
  let ops: any[] = [];
  const counts: Record<string, number> = { tc: 0, ai: 0, rp: 0 };
  let inserted = 0, skipped = 0;
  const flush = async () => {
    if (!ops.length) return;
    if (APPLY) { const r = await attempts.bulkWrite(ops, { ordered: false }); inserted += r.upsertedCount; skipped += ops.length - r.upsertedCount; }
    ops = [];
  };
  const push = (doc: FirstTranslationAttempt) => { ops.push({ updateOne: { filter: { attempt_id: doc.attempt_id }, update: { $setOnInsert: doc }, upsert: true } }); };

  // ── Pass 1: translation_classification ──────────────────────────────
  for await (const d of db.collection('translation_classification').find({ book_id: { $exists: true } }) as any) {
    const cls = d.classification;
    const found = cls === 'previously_translated' || cls === 'partially_translated';
    const priors: PriorTranslation[] = d.known_translation
      ? [{ english_title: String(d.known_translation).slice(0, 300), completeness: cls === 'partially_translated' ? 'partial' : 'complete', source_url: undefined }]
      : [];
    push({
      attempt_id: `${d.book_id}:legacy_tc:${toIso(d.classified_at)}`, book_id: d.book_id, date: toIso(d.classified_at),
      method: 'gemini_verifier', match_key: 'none', sources_checked: [], queries: [],
      result: found ? 'found' : 'none', priors, evidence_strength: 'weak', independence_score: 0.1,
      model: d.model, notes: `[legacy_tc] classification=${cls}; ${(d.reasoning || '').slice(0, 400)}`,
    });
    counts.tc++; if (ops.length >= 1000) await flush();
  }
  await flush();

  // ── Pass 2: ai_metadata.first_translation (book field) ──────────────
  for await (const b of db.collection('books').find(
    { 'ai_metadata.first_translation': { $exists: true } },
    { projection: { id: 1, 'ai_metadata.first_translation': 1 } },
  ) as any) {
    const bookId = b.id ?? String(b._id);
    const ft = b.ai_metadata.first_translation || {};
    const known: string[] = Array.isArray(ft.known_translations) ? ft.known_translations : [];
    const priors: PriorTranslation[] = known.filter(Boolean).map((t: any) => ({
      english_title: typeof t === 'string' ? t.slice(0, 300) : (t?.english_title || t?.title), source_url: undefined,
    })).filter((p: PriorTranslation) => p.english_title);
    push({
      attempt_id: `${bookId}:legacy_ai:${FALLBACK_DATE}`, book_id: bookId, date: FALLBACK_DATE,
      method: 'gemini_verifier', match_key: 'none', sources_checked: [], queries: [],
      result: priors.length ? 'found' : 'none', priors, evidence_strength: 'weak', independence_score: 0.1,
      notes: `[legacy_ai] status=${ft.status ?? '?'}; ${(ft.reasoning || '').slice(0, 400)}`,
    });
    counts.ai++; if (ops.length >= 1000) await flush();
  }
  await flush();

  // ── Pass 3: ft_reverify_proposal (STRUCTURED translations) ──────────
  for await (const d of db.collection('ft_reverify_proposal').find({ book_id: { $exists: true } }) as any) {
    const trans: any[] = Array.isArray(d.translations) ? d.translations : [];
    const priors: PriorTranslation[] = trans.map((t) => ({
      english_title: t?.english_title || t?.title, translator: t?.translator, pub_year: t?.pub_year,
      publisher: t?.publisher, completeness: t?.completeness, source_url: t?.url || t?.source_url || undefined,
    })).filter((p) => p.english_title);
    const sources = d.catalog_counts ? Object.entries(d.catalog_counts).filter(([, n]) => (n as number) > 0).map(([k]) => k) : [];
    const found = priors.length > 0 || d.has_english_translation === true;
    push({
      attempt_id: `${d.book_id}:legacy_rp:${toIso(d.created_at)}`, book_id: d.book_id, date: toIso(d.created_at),
      method: 'gemini_verifier', match_key: 'none', sources_checked: sources, queries: [],
      result: found ? 'found' : 'none', priors,
      evidence_strength: (d.evidence_strength === 'strong' || d.evidence_strength === 'moderate') ? d.evidence_strength : 'weak',
      independence_score: d.grounded ? 0.5 : 0.3,
      notes: `[legacy_rp] verdict=${d.verdict ?? '?'}; ${(d.reasoning || '').slice(0, 400)}`,
    });
    counts.rp++; if (ops.length >= 1000) await flush();
  }
  await flush();

  console.log(`built — tc:${counts.tc} ai:${counts.ai} rp:${counts.rp}`);
  if (APPLY) console.log(`APPLIED — inserted ${inserted} new attempts; ${skipped} already present (idempotent)`);
  else console.log('DRY-RUN — re-run with --apply.');
}
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
