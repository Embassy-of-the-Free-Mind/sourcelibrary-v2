#!/usr/bin/env node
/**
 * retract-english-source-ft-3433.mjs — withdraw the first-translation badge from
 * books that are translations OUT OF an English original (#3433).
 *
 * PRIOR ART: scripts/maintenance/retract-tibetan-ft-claims.mjs — same two-sink
 * shape (human attempt row + matching verdict); it selects by language and
 * leaves the boolean to a reconcile script that is now retired (#4536), so it
 * cannot be reused as-is. scripts/audit/ft-source-language-screen.mjs screens
 * for pages that ARE English, not for a foreign text whose SOURCE is English.
 *
 * WHY
 * ---
 * Hobbes wrote *Leviathan* in English (1651). Our 1667 Dutch *Leviathan* was
 * badged "First translation" (`first_from_source`, strong) by a verifier whose
 * own reasoning said "the Dutch edition is a translation of the original
 * English … no English translation of the Dutch text itself exists". True and
 * vacuous: an English rendering of it is a back-translation, not a first
 * translation of anything. `first_from_source` is for English that exists from a
 * DIFFERENT source language; it does not fit a text that descends from English.
 * The vocabulary already has the right value — `not_applicable` is documented
 * in src/lib/first-translation/types.ts as covering an "English-source
 * original".
 *
 * WHAT IS IN THE LIST, AND WHY ONLY THIS
 * --------------------------------------
 * A hand-reviewed list, not a query. Each entry is a translation into Dutch of
 * a work its author published in English, checked on our own pages:
 *   - Hobbes, Leviathan, of van de Stoffe (1667) ← Leviathan, London 1651
 *   - Raleigh, Waerachtighe … beschryvinghe van Guiana (1598) ← The Discoverie
 *     of … Guiana, London 1596 (our title page p.7 is the Dutch title)
 *   - Potter, Een verklaringh over het getal 666 (1659) ← An Interpretation of
 *     the Number 666, Oxford 1642 (our preface: "gedaen in de Engelsche Tale";
 *     the work's own card already lists the 1642 English)
 * Deliberately NOT here: Pordage's German Metaphysica (English original lost,
 * so the German is the surviving witness), the Vaughan "Aula Lucis" PH114 A
 * manuscript (its pages read as handwritten English: identity unclear), and
 * Starkey/Ripley/F. Bacon bundles (mixed Latin/English sources). Those are
 * listed on #3433 for review.
 *
 * WHAT IT WRITES (per book)
 *   first_translation_attempts  one `human` row, result 'not_applicable', with
 *                               the book's PRIOR first_translation /
 *                               is_first_translation / text_role in `prior_state`
 *                               so the change is reversible from the ledger.
 *   books.first_translation     verdict 'not_applicable', resolver 'human'.
 *   books.is_first_translation  false. The field is frozen except through
 *                               reviewed card work (#4536); the work's card is
 *                               consistent with this (Leviathan: prior_exists;
 *                               the other two: under_review, so no card sentence
 *                               renders either way).
 *   books.text_role             'period-translation' (all three are pre-1700
 *                               translations; classify-text-role.mjs's rule),
 *                               text_role_source 'manual-3433'.
 *   books.original_language     'English', only where it is unset.
 *   books.updated_at            bumped, so the incremental books_catalog sync
 *                               (every 2 h) carries the boolean to the catalog.
 *   sweep_log                   one row per book.
 * `prior_translation` is left alone: on Leviathan it is correct and verified.
 *
 * Dry-run by default. --apply writes. Idempotent (attempt id is deterministic;
 * a book already in the target state is skipped).
 *   node --env-file=.env.production.local scripts/maintenance/retract-english-source-ft-3433.mjs
 *   node --env-file=.env.production.local scripts/maintenance/retract-english-source-ft-3433.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SRC = 'ft-3433-english-source';

const TARGETS = [
  { id: '69b18a7cc4be2cdd0edc7c3b', source: 'Hobbes, Leviathan (London: Andrew Crooke, 1651), written in English; this is the 1667 Dutch translation.' },
  { id: '69b21db694025df5d2909995', source: 'Raleigh, The Discoverie of the Large, Rich, and Bewtiful Empyre of Guiana (London, 1596), written in English; this is the 1598 Dutch translation.' },
  { id: '69c581f0a0ac0c96f42b4018', source: 'Potter, An Interpretation of the Number 666 (Oxford, 1642), written in English; this is the 1659 Dutch translation (its preface says the work was done "in de Engelsche Tale").' },
];

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
const nowIso = new Date().toISOString();
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const attempts = db.collection('first_translation_attempts');

let wrote = 0;
for (const t of TARGETS) {
  const b = await db.collection('books').findOne({ id: t.id }, {
    projection: { _id: 1, id: 1, title: 1, work_id: 1, is_first_translation: 1, first_translation: 1, text_role: 1, text_role_source: 1, original_language: 1 },
  });
  if (!b) { console.log(`NOT FOUND ${t.id}`); continue; }
  const done = b.is_first_translation === false && b.first_translation?.verdict === 'not_applicable'
    && b.first_translation?.retraction_reason === SRC;
  console.log(`${done ? 'already done' : 'retract'}  ${t.id}  ${b.title}`);
  console.log(`    now: is_first_translation=${b.is_first_translation} verdict=${b.first_translation?.verdict} text_role=${b.text_role} original_language=${b.original_language ?? '(unset)'}`);
  if (done) continue;

  const aid = 'a_' + createHash('sha1').update(`${t.id}|${SRC}`).digest('hex').slice(0, 20);
  const note = `[#3433] Not a first translation: our text is a translation OUT OF an English original. ${t.source} `
    + 'An English rendering of it is a back-translation. Badge withdrawn; the text stays published.';
  const attemptDoc = {
    attempt_id: aid, book_id: t.id, work_id: b.work_id || null,
    date: nowIso, method: 'human', match_key: 'none',
    sources_checked: [], queries: [], found_refs: [],
    result: 'not_applicable', evidence_strength: 'strong',
    notes: note,
    prior_state: {
      is_first_translation: b.is_first_translation ?? null,
      first_translation: b.first_translation ?? null,
      text_role: b.text_role ?? null,
      text_role_source: b.text_role_source ?? null,
      original_language: b.original_language ?? null,
    },
    _src: SRC,
  };
  const ft = {
    verdict: 'not_applicable',
    evidence_strength: 'strong',
    our_completeness: b.first_translation?.our_completeness || 'unknown',
    match_key: 'none',
    resolver: 'human',
    best_attempt_id: aid,
    resolved_at: nowIso,
    retraction_reason: SRC,
  };
  const set = {
    first_translation: ft,
    is_first_translation: false,
    text_role: 'period-translation',
    text_role_source: 'manual-3433',
    updated_at: new Date(),
  };
  if (!b.original_language) set.original_language = 'English';
  console.log(`    set: ${JSON.stringify({ ...set, first_translation: `{verdict:not_applicable, resolver:human, attempt ${aid}}` })}`);
  if (APPLY) {
    await attempts.updateOne({ attempt_id: aid }, { $set: attemptDoc }, { upsert: true });
    await db.collection('books').updateOne({ _id: b._id }, { $set: set });
    await recordSweepAction(db, { sweep: SRC, book_id: t.id, action: 'ft-badge-withdrawn-english-source', detail: { attempt_id: aid } });
    wrote++;
  }
}
console.log(APPLY ? `\nAPPLIED: ${wrote} books.` : '\nDRY-RUN: nothing written. Re-run with --apply.');
if (APPLY && wrote) console.log('ACTUATION: the books_catalog incremental sync (every 2 h) carries is_first_translation=false to the card surfaces; /book pages read Atlas on their next render.');
await c.close();
