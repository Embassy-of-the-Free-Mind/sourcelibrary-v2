#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/harvest-priors-to-card-proposals.mjs (moves ledger citations onto cards; it
 * never checks a card's status against its own entries). scripts/eval/card-prior-candidates.mjs (probes
 * EMPTY cards for catalogue candidates; status-blind). scripts/audit/pipeline-hold-drift.mjs (the
 * exit-code and --json shape this follows). None asserts that a card's status agrees with its entries.
 *
 * Asserts that each Translation Card's (`work_translation_history`) status agrees with its own entries
 * (#4575, card method rule "a card's status must be derivable from its own entries"):
 *
 *   EMPTY_PRIOR   status prior_exists / antiquated_or_partial_only with NO usable entry (title or
 *                 translator, the same filter cardLabel() applies). "Earlier translations exist" with
 *                 none listed. cardLabel() renders nothing for it, so readers see silence, but the card
 *                 lies to every instrument that reads status. Must be 0; exit 1 otherwise.
 *                 38 cards found on 2026-09-02, seeded by ft-work-registry-pilot.mjs, which mapped
 *                 the qualified-first verdicts (first_modern / first_complete / first_from_source)
 *                 to prior_exists without finding the prior. Repair:
 *                 scripts/maintenance/hold-empty-prior-exists-cards.mjs.
 *   NPK_COMPLETE  informational: status no_prior_known while an entry says completeness 'complete'.
 *                 Most of those entries are unverified suggestions (gemini_verifier carries a measured
 *                 ~20% false-found rate, #4525), so each needs a reviewer, not a sweep. Listed, never
 *                 fails the run: a backlog that keeps an alarm red is a mute button
 *                 (measurement-instruments.md).
 *
 * Exit 0 = clean, 1 = EMPTY_PRIOR found, 2 = could not measure (UNKNOWN is not PASS).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/card-status-consistency.mjs
 *   … --json        machine-readable summary on stdout
 *   … --sample=N    rows listed per class (default 10)
 */
import { MongoClient } from 'mongodb';
import { fileURLToPath } from 'node:url';

export const CARDS = 'work_translation_history';
export const PRIOR_STATUSES = ['prior_exists', 'antiquated_or_partial_only'];

/** cardLabel()'s own entry filter (src/lib/first-translation/card.ts). */
export const usableEntry = (e) => !!(e && (e.title || e.translator));

/** True when a card claims priors but lists none a reader could be shown. */
export function isEmptyPrior(card) {
  return PRIOR_STATUSES.includes(card?.status) && !(card.entries ?? []).some(usableEntry);
}

/** Mongo prefilter for isEmptyPrior (the JS predicate is the authority). */
export const EMPTY_PRIOR_QUERY = {
  status: { $in: PRIOR_STATUSES },
  $nor: [{ entries: { $elemMatch: { $or: [{ title: { $nin: [null, ''] } }, { translator: { $nin: [null, ''] } }] } } }],
};

async function main() {
  const JSON_OUT = process.argv.includes('--json');
  const SAMPLE = Number(process.argv.find((a) => a.startsWith('--sample='))?.split('=')[1] ?? 10);
  const log = (...a) => { if (!JSON_OUT) console.log(...a); };
  let mongo;
  try {
    mongo = new MongoClient(process.env.MONGODB_URI);
    await mongo.connect();
  } catch (e) {
    console.error(`UNKNOWN: cannot reach Mongo — ${e.message}`);
    process.exit(2);
  }
  try {
    const col = mongo.db('bookstore').collection(CARDS);
    const proj = { _id: 1, status: 1, work_title: 1, entries: 1, 'review.verified_by': 1, seeded_from: 1 };
    const total = await col.estimatedDocumentCount();
    if (!total) {
      console.error(`UNKNOWN: ${CARDS} reads as empty — refusing to report PASS`);
      process.exit(2);
    }
    const emptyPrior = (await col.find(EMPTY_PRIOR_QUERY, { projection: proj }).toArray()).filter(isEmptyPrior);
    const npkComplete = await col.find(
      { status: 'no_prior_known', 'entries.completeness': 'complete' },
      { projection: { _id: 1, work_title: 1 } },
    ).toArray();

    const bySeed = {};
    for (const c of emptyPrior) bySeed[c.seeded_from ?? '?'] = (bySeed[c.seeded_from ?? '?'] ?? 0) + 1;
    const summary = {
      measured_at: new Date().toISOString(),
      cards: total,
      empty_prior: emptyPrior.length,
      empty_prior_by_seed: bySeed,
      npk_complete: npkComplete.length,
      empty_prior_sample: emptyPrior.slice(0, SAMPLE).map((c) => ({ _id: c._id, status: c.status, title: String(c.work_title ?? '').slice(0, 80) })),
      npk_complete_sample: npkComplete.slice(0, SAMPLE).map((c) => ({ _id: c._id, title: String(c.work_title ?? '').slice(0, 80) })),
    };
    if (JSON_OUT) console.log(JSON.stringify(summary, null, 1));
    log(`card-status-consistency — ${total} cards`);
    log(`  EMPTY_PRIOR   ${emptyPrior.length}  (must be 0)  ${JSON.stringify(bySeed)}`);
    for (const r of summary.empty_prior_sample) log(`      ${r.status.padEnd(26)} ${r._id.slice(0, 60)}  ${r.title.slice(0, 50)}`);
    log(`  NPK_COMPLETE  ${npkComplete.length}  (informational: no_prior_known beside a 'complete' entry)`);
    log(emptyPrior.length ? 'FAIL' : 'PASS');
    process.exitCode = emptyPrior.length ? 1 : 0;
  } catch (e) {
    console.error(`UNKNOWN: ${e.message}`);
    process.exitCode = 2;
  } finally {
    await mongo.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
