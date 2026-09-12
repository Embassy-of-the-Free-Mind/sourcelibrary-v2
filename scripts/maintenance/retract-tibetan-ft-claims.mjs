#!/usr/bin/env node
/**
 * retract-tibetan-ft-claims.mjs — withdraw the first-translation CLAIM from
 * Tibetan books whose transcription we cannot vouch for (#4523).
 *
 * WHY
 * ---
 * You cannot be the first to translate a text you did not transcribe. #4523
 * established that OCR of handwritten Tibetan is unreliable: independent runs of
 * the same folio agree at 31-35% (a legible printed page scores 87-93%), and the
 * failure mode is fluent invented text in the wrong script — one confirmed page
 * renders a Bhutanese Nyingma pecha as "॥ श्रीरामचन्द्राय नमः ॥", with the
 * published English faithfully translating the invention. 643 of the 795 badged
 * Tibetan books are predominantly handwritten. This was previously characterised
 * in July 2026 (#3244 / PR #3252); the claims were never withdrawn.
 *
 * Derek's decision, 2026-09-01: "we can't claim those are translations, I agree.
 * we don't need to withdraw the text yet though." So this retracts the CLAIM and
 * leaves the text in place. A reader-facing warning ships separately.
 *
 * MECHANISM — the two sanctioned writers, in order
 * ------------------------------------------------
 * `is_first_translation` is a materialized read of `book.first_translation`,
 * and the 05:30 derive recomputes that verdict from the attempt ledger nightly.
 * So a hand-set verdict would be silently reverted. This writes BOTH, matching:
 *   Sink A  first_translation_attempts — one `human` row, result 'not_applicable'
 *   Sink B  book.first_translation     — the verdict derive produces from it
 * Verified against `deriveVerdictFromAttempts`: a human `not_applicable` row
 * yields verdict `not_applicable`, resolver `human`, and overrides an existing
 * tier2 `first_no_prior`. So tonight's derive will recompute to the same value
 * rather than undoing this.
 *
 * It does NOT touch the public boolean. Run afterwards:
 *   npx tsx scripts/maintenance/reconcile-first-translation-flag.ts \
 *     --ids=<ids.txt> --apply --only-demotions
 *
 * VOCABULARY CAVEAT (read before citing this data)
 * ------------------------------------------------
 * `not_applicable` is defined as "our item is already in English, or is wordless
 * visual art". Neither is true here. It is used because it is the only value
 * that derives to a demotion, and because operationally it does say the right
 * thing — the claim is ill-posed for this item, which is also how
 * apply-tibetan-container-verdicts.mjs used it for non-single-work containers.
 * The honest state is "transcription unverified", which does not exist in the
 * eight-verdict vocabulary; adding it is a reviewed change under the #3881
 * mechanism budget. Every row here carries `_src: 'ft-4523-tibetan-retraction'`
 * so the set is queryable and reversible.
 *
 * Dry-run by default. --apply writes.
 *   node --env-file=.env.production.local scripts/maintenance/retract-tibetan-ft-claims.mjs
 *   node --env-file=.env.production.local scripts/maintenance/retract-tibetan-ft-claims.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const OUT_IDS = (args.find((a) => a.startsWith('--out-ids=')) || '').split('=')[1]
  || 'scripts/output/ft-4523-tibetan-ids.txt';
const LIMIT = parseInt((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10);
const SRC = 'ft-4523-tibetan-retraction';
const nowIso = new Date().toISOString();

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = db.collection('books');
const attempts = db.collection('first_translation_attempts');

const q = { language: 'Tibetan', is_first_translation: true };
const targets = await books.find(q, { projection: { _id: 1, id: 1, title: 1, work_id: 1, first_translation: 1 } }).toArray();
const list = LIMIT ? targets.slice(0, LIMIT) : targets;
console.log(`badged Tibetan books: ${targets.length}${LIMIT ? ` (limited to ${list.length})` : ''}`);

const priorVerdicts = new Map();
for (const b of list) {
  const v = b.first_translation?.verdict || '(none)';
  priorVerdicts.set(v, (priorVerdicts.get(v) || 0) + 1);
}
console.log('current verdicts being retracted:');
for (const [v, n] of [...priorVerdicts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padEnd(20)} ${n}`);

const NOTE = '[#4523] First-translation claim retracted: OCR of handwritten Tibetan '
  + 'is unreliable (independent runs of the same folio agree at 31-35% vs 87-93% for a '
  + 'legible printed page; confirmed cases render Tibetan folios as Devanagari Hindu '
  + 'scripture). We cannot claim to be first to translate a text we have not reliably '
  + 'transcribed. The scan and its text remain published; only the claim is withdrawn. '
  + 'Reinstate if a trustworthy transcription is produced (gemini-3.1-pro re-OCR was '
  + 'verified to rescue such pages in June 2026).';

let wrote = 0;
const ids = [];
for (const b of list) {
  const bid = String(b.id || b._id);
  ids.push(bid);
  const aid = 'a_' + createHash('sha1').update(`${bid}|${SRC}`).digest('hex').slice(0, 20);
  const attemptDoc = {
    attempt_id: aid, book_id: bid, work_id: b.work_id || null,
    date: nowIso, method: 'human', match_key: 'none',
    sources_checked: [], queries: [], found_refs: [],
    result: 'not_applicable',
    evidence_strength: 'strong',
    notes: NOTE,
    _src: SRC,
  };
  const ft = {
    verdict: 'not_applicable',
    evidence_strength: 'strong',
    our_completeness: 'unknown',
    match_key: 'none',
    resolver: 'human',
    best_attempt_id: aid,
    resolved_at: nowIso,
    retraction_reason: SRC,
  };
  if (APPLY) {
    await attempts.updateOne({ attempt_id: aid }, { $set: attemptDoc }, { upsert: true });
    await books.updateOne({ _id: b._id }, { $set: { first_translation: ft } });
    wrote++;
  }
}
writeFileSync(OUT_IDS, ids.join('\n') + '\n');
console.log(`\nids written: ${OUT_IDS} (${ids.length})`);

if (!APPLY) {
  console.log(`\nDRY-RUN — nothing written. Would write ${ids.length} attempts + verdicts.`);
  console.log('Re-run with --apply, then:');
  console.log(`  npx tsx scripts/maintenance/reconcile-first-translation-flag.ts --ids=${OUT_IDS} --apply --only-demotions`);
} else {
  console.log(`\nAPPLIED — ${wrote} attempts + verdicts written.`);
  console.log('ACTUATION NOTE: the 05:30 derive reads first_translation_attempts and will');
  console.log('recompute these to the SAME not_applicable verdict (verified against');
  console.log('deriveVerdictFromAttempts), so it will not undo this.');
  console.log('The public boolean is still TRUE until you run:');
  console.log(`  npx tsx scripts/maintenance/reconcile-first-translation-flag.ts --ids=${OUT_IDS} --apply --only-demotions`);
}
await c.close();
