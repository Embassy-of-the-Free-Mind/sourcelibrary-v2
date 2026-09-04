#!/usr/bin/env node
/**
 * Phase 7.7 — Prior-translation check, at pipeline time. (#4617)
 *
 * PRIOR ART:
 *   scripts/eval/ft-catalog-match.mjs  — the deterministic Tier-0 matcher and
 *     its five guards. IMPORTED here, not reimplemented. It is a REPORTER: it
 *     scans already-badged books and emits demote candidates for sign-off. It
 *     has no pipeline trigger, so a book finishing translation today is never
 *     scanned by it.
 *   src/lib/ft-prior-guard.ts — the TS twin of those guards (ANTHOLOGY,
 *     PARTIAL, SOURCE_LANG …), used on the derive path.
 *   scripts/lib/search-effort.mjs — the argument this phase implements: publish
 *     the bounded search, do not assert the unbounded negative.
 *   scripts/lib/ft-attempt-log.mjs — the attempt ledger.
 *   None of them run when a book finishes translating. THAT is the gap, and it
 *   is the whole reason a retroactive 11,530-work drain exists: 13 of the 15
 *   most recently translated Forum-of-Conscience books have no card at all.
 *
 * WHAT THIS DOES, EXACTLY
 *   For each book that has just become translated and whose work has no settled
 *   card, match it against the 24,130-row `translation_catalogs` collection
 *   (98.9% Latin — which is precisely the Conscience corpus) and write ONE card:
 *     - a guard-passing match  -> status prior_exists, with the matched entry
 *     - no match               -> status no_prior_known, with the search record
 *   No LLM call. No model is ever asked to assert an absence. The card's own
 *   sentence is hedged ("Possibly the first English translation — no earlier one
 *   is known to us"), so `no_prior_known` claims only what was searched.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - never demotes or edits a card another instrument already settled
 *   - never writes `books.is_first_translation` (frozen since #4536)
 *   - never touches `translation_verification` (the broken lane, #4634)
 *   A catalogue miss is NOT evidence of absence beyond the catalogue, and the
 *   card says so. Latin coverage is real; everything else is thin, and the
 *   search record names that gap per book rather than hiding it.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/workers/prior-translation-check.mjs [--limit=N] [--collection=slug] [--book=ID] [--apply]
 *   Default is a DRY RUN that prints every decision and writes nothing.
 */

import { MongoClient } from 'mongodb';
import { buildCatalogIndex, matchBookToCatalog } from '../eval/ft-catalog-match.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const APPLY = argv.includes('--apply');
const LIMIT = parseInt(arg('limit', '50'), 10);
const COLLECTION = arg('collection');
const BOOK = arg('book');
const STAMP = 'pipeline_catalog_match_v1';

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books');
const cards = db.collection('work_translation_history');

// ── the reference set, stated so the card can name its own boundary ──────────
const catRows = await db.collection('translation_catalogs').find({},
  { projection: { canonical_author: 1, author: 1, author_surname: 1, english_title: 1,
    canonical_work: 1, translator: 1, year: 1, publisher: 1, completeness: 1,
    source_language: 1, series: 1, citation_url: 1, url: 1 } }).toArray();
const bySurname = buildCatalogIndex(catRows);
const byLang = {};
for (const r of catRows) byLang[r.source_language ?? '?'] = (byLang[r.source_language ?? '?'] ?? 0) + 1;
const REFERENCE_SET = `translation_catalogs snapshot: ${catRows.length} rows (${Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')})`;

// ── candidates: translated, visible, and not already settled ─────────────────
const q = { pages_translated: { $gt: 0 }, work_id: { $exists: true, $ne: null } };
if (BOOK) q.id = BOOK;
if (COLLECTION) q.collections = COLLECTION;
const candidates = await books.find(q,
  { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1,
    original_language: 1, work_id: 1, collections: 1, last_translation_at: 1,
    visible: 1, pages_count: 1 } })
  .sort({ last_translation_at: -1 }).limit(LIMIT).toArray();

const workIds = [...new Set(candidates.map((b) => b.work_id))];
const existing = new Map((await cards.find({ _id: { $in: workIds } })
  .project({ _id: 1, status: 1, review: 1 }).toArray()).map((c) => [c._id, c]));

const decisions = [];
for (const b of candidates) {
  const card = existing.get(b.work_id);
  // Only ever fill a VOID. A card another instrument settled is left alone —
  // this phase adds coverage, it does not arbitrate.
  if (card && card.status !== 'under_review') {
    decisions.push({ book: b, action: 'SKIP_settled', detail: `card already ${card.status}` });
    continue;
  }
  if (card?.review?.identity_flag) {
    decisions.push({ book: b, action: 'SKIP_held', detail: 'card held for identity review' });
    continue;
  }
  const m = matchBookToCatalog(b, bySurname);
  if (m && m.tier === 'demote_candidate') {
    decisions.push({ book: b, action: 'SET_prior_exists', match: m.best_match, detail: `${m.match_count} catalog match(es), all guards pass` });
  } else if (m) {
    // Matched on author+title but a guard fired (anthology/study, partial,
    // wrong source language, volume or namesake mismatch). That is exactly the
    // Godwin-monograph shape, and it must NOT become a prior — but it is also
    // not clean evidence of absence, so the work goes to review, not to a claim.
    decisions.push({ book: b, action: 'HOLD_guard_fired', match: m.best_match, detail: `guards failed: ${m.best_match.failed_guards.join(', ')}` });
  } else {
    decisions.push({ book: b, action: 'SET_no_prior_known', detail: 'no author+title match in the reference set' });
  }
}

// ── report (this is the "see what it does" half) ─────────────────────────────
const tally = {};
for (const d of decisions) tally[d.action] = (tally[d.action] ?? 0) + 1;
console.log(`Phase 7.7 — prior-translation check  [${APPLY ? 'APPLY' : 'DRY RUN'}]`);
console.log(REFERENCE_SET);
console.log(`candidates: ${candidates.length}${COLLECTION ? ` in "${COLLECTION}"` : ''}\n`);
for (const d of decisions) {
  const t = String(d.book.display_title || d.book.title).slice(0, 52);
  console.log(`  ${d.action.padEnd(19)} ${String(d.book.language ?? '?').padEnd(9)} ${t}`);
  console.log(`      ${d.detail}`);
  if (d.match) {
    console.log(`      -> "${String(d.match.english_title ?? d.match.canonical_work ?? '?').slice(0, 58)}" — ${d.match.translator ?? '?'}, ${d.match.year ?? '?'} [${d.match.completeness ?? '?'}]`);
  }
}
console.log(`\n${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply.');
  await client.close();
  process.exit(0);
}

const { recordSweepAction } = await import('../lib/sweep-log.mjs');
let wrote = 0;
for (const d of decisions) {
  if (d.action.startsWith('SKIP')) continue;
  const now = new Date();
  const searchSummary = `Catalogue check ${now.toISOString().slice(0, 10)} (${STAMP}): matched author+title against ${REFERENCE_SET}. Deterministic; no web search. A miss here is absence FROM THIS SET — Latin coverage is dense, other languages are thin.`;

  const stage = {
    review: { $mergeObjects: [{ $ifNull: ['$review', {}] }, {
      verified_by: STAMP, verified_at: now.toISOString(), notes: d.detail,
    }] },
    search: { $mergeObjects: [{ $ifNull: ['$search', {}] }, { summary: searchSummary }] },
    updated_at: now,
  };
  if (d.action === 'SET_prior_exists') {
    stage.status = 'prior_exists';
    stage.entries = [{
      kind: 'english_translation',
      year: d.match.year ?? null,
      translator: d.match.translator ?? null,
      title: d.match.english_title ?? d.match.canonical_work ?? null,
      publisher: d.match.publisher ?? null,
      completeness: d.match.completeness ?? null,
      citation_url: d.match.citation_url ?? d.match.url ?? null,
      verified: false,                    // catalogue-derived, not page-read
      source_methods: [STAMP],
    }];
  } else if (d.action === 'SET_no_prior_known') {
    stage.status = 'no_prior_known';
  } else {
    stage.status = 'under_review';
    stage.review.$mergeObjects[1].identity_flag = true;
  }

  // Upsert: most of these works have no card row at all yet.
  const res = await cards.updateOne(
    { _id: d.book.work_id, status: { $in: ['under_review', null] } },
    [{ $set: { _id: d.book.work_id, work_id: d.book.work_id, work_title: d.book.display_title || d.book.title, author: d.book.author ?? null, ...stage } }],
    { upsert: true },
  );
  if (res.modifiedCount === 1 || res.upsertedCount === 1) {
    wrote++;
    await recordSweepAction(db, {
      script: 'prior-translation-check.mjs', issue: '#4617',
      collection: 'work_translation_history', target: d.book.work_id,
      action: d.action, detail: d.detail,
    }).catch(() => {});
  }
}
console.log(`\nAPPLIED: ${wrote} cards written (guard: only unsettled cards touched)`);
await client.close();
