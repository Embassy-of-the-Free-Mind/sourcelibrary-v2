#!/usr/bin/env node
/**
 * Phase 7.7 — Prior-translation check, at pipeline time. (#4617)
 *
 * PRIOR ART:
 *   scripts/eval/ft-catalog-match.mjs — Tier 0: the deterministic matcher over
 *     our own 24,130-row `translation_catalogs`, with its five guards
 *     (ANTHOLOGY/study, COMPLETENESS, SOURCE_LANG, VOLUME, NAMESAKE). IMPORTED,
 *     not reimplemented. It is a REPORTER with no pipeline trigger, so it never
 *     sees a book on the day that book finishes.
 *   scripts/lib/prior-translation-search.mjs — Tier 1: the search standard as
 *     deterministic API calls (written alongside this file).
 *   src/lib/ft-prior-guard.ts — the TS twin of the guards, used on derive.
 *   scripts/lib/search-effort.mjs — the doctrine: publish the bounded search,
 *     never assert the unbounded negative.
 *
 * THE GAP THIS CLOSES
 *   A book could finish OCR, translation, summary, chapters, quality scoring and
 *   collection assignment without once being asked "has anyone Englished this
 *   before?" — 13 of the 15 most recently translated Forum-of-Conscience books
 *   had no card at all. The retroactive 11,530-work drain exists because of that.
 *
 * TWO TIERS, NEITHER USING A MODEL
 *   Tier 0  our catalogue. Free, instant — and 98.9% Latin classics, so its
 *           silence on 16th-c casuistry is not an answer, only a miss.
 *   Tier 1  go and actually look: OpenLibrary, archive.org and K10plus all
 *           filter on language and can support "no English edition here";
 *           Crossref has no language filter (it answered the Summa Angelica with
 *           OED headwords and the Latin 1542 edition) so it is advisory only.
 *
 * OUTCOMES
 *   SET_prior_exists      tier-0 match, every guard passed
 *   HOLD_guard_fired      matched but a guard blocked it (the Godwin-monograph
 *                         shape) — recorded, never rendered as a prior
 *   HOLD_candidate_found  tier-1 English candidate — needs a page read first
 *   HOLD_source_down      a DECIDING source was unreachable. "Nothing found" and
 *                         "we did not look" are different, and this is the line
 *   SET_no_prior_known    catalogue miss + every deciding source answered zero
 *
 * Never demotes, never edits a settled card, never writes `is_first_translation`
 * (frozen, #4536) or `translation_verification` (broken, #4634).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/workers/prior-translation-check.mjs \
 *        [--limit=N] [--collection=slug] [--book=ID] [--apply]
 *   Dry run by default.
 */

import { MongoClient } from 'mongodb';
import { buildCatalogIndex, matchBookToCatalog } from '../eval/ft-catalog-match.mjs';
import { searchPriorTranslations } from '../lib/prior-translation-search.mjs';

const STAMP = 'pipeline_prior_check_v1';

/**
 * The phase body. Exported so enrich-worker.mjs can call it as Phase 7.7 with an
 * open db handle. Returns { written, summary, decisions }. A network failure
 * becomes a HOLD, never a silent absence claim.
 */
export async function runPriorTranslationCheck({
  db, limit = 50, collection = null, book = null, apply = false, log = console.log,
} = {}) {
  const books = db.collection('books');
  const cards = db.collection('work_translation_history');

  // ── the reference set, stated so each card can name its own boundary ──────
  const catRows = await db.collection('translation_catalogs').find({},
    { projection: { canonical_author: 1, author: 1, author_surname: 1, english_title: 1,
      canonical_work: 1, translator: 1, year: 1, publisher: 1, completeness: 1,
      source_language: 1, series: 1, citation_url: 1, url: 1 } }).toArray();
  const bySurname = buildCatalogIndex(catRows);
  const byLang = {};
  for (const r of catRows) byLang[r.source_language ?? '?'] = (byLang[r.source_language ?? '?'] ?? 0) + 1;
  const REFERENCE_SET = `translation_catalogs snapshot: ${catRows.length} rows (${Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')})`;

  // ── candidates: translated, with a work, not already settled ──────────────
  const q = { pages_translated: { $gt: 0 }, work_id: { $exists: true, $ne: null } };
  if (book) q.id = book;
  if (collection) q.collections = collection;
  const candidates = await books.find(q,
    { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1,
      original_language: 1, work_id: 1, last_translation_at: 1 } })
    .sort({ last_translation_at: -1 }).limit(limit).toArray();

  const workIds = [...new Set(candidates.map((b) => b.work_id))];
  const existing = new Map((await cards.find({ _id: { $in: workIds } })
    .project({ _id: 1, status: 1, review: 1 }).toArray()).map((c) => [c._id, c]));

  const decisions = [];
  // ONE decision per WORK, not per book. Several books commonly share a work
  // (an original and its reprint; a Latin title and its English display title),
  // and the card is keyed on the work. Writing per book made the first write
  // settle the card and the second collide on _id — a duplicate-key crash that
  // aborted the run mid-way on the very first apply.
  const seenWorks = new Set();
  for (const b of candidates) {
    if (seenWorks.has(b.work_id)) {
      decisions.push({ book: b, action: 'SKIP_same_work', detail: `another book already decided work ${b.work_id}` });
      continue;
    }
    seenWorks.add(b.work_id);
    const card = existing.get(b.work_id);
    // Only ever fill a VOID. A card another instrument settled is left alone —
    // this phase adds coverage, it does not arbitrate.
    if (card && card.status !== 'under_review') {
      decisions.push({ book: b, action: 'SKIP_settled', detail: `card already ${card.status}` });
      continue;
    }
    if (card?.review?.identity_flag) {
      decisions.push({ book: b, action: 'SKIP_held', detail: 'card held for review' });
      continue;
    }
    // A card can be `under_review` and STILL carry a cited prior that some
    // earlier instrument recorded. Writing no_prior_known onto it produces a
    // page that says "possibly the first English translation" directly above a
    // named earlier one — the exact contradiction repaired across 74 cards
    // earlier today. merge-tranche-review.mjs already refuses this; the rule is
    // ported here rather than learned twice.
    const citedOnCard = (card?.entries ?? []).filter((e) => e.citation_url);
    if (citedOnCard.length) {
      decisions.push({
        book: b, action: 'SKIP_has_prior',
        detail: `card already cites ${citedOnCard.length} prior (${citedOnCard.map((e) => `${e.translator ?? '?'} ${e.year ?? ''}`.trim()).join('; ').slice(0, 70)}) — not ours to overwrite`,
      });
      continue;
    }

    // `language` is NOT trustworthy enough to gate on. Measured 2026-09-05:
    // 3,649 books have disagreeing language claims, and the two Conscience books
    // in this very collection are filed Spanish and Russian for Latin texts —
    // one because our importer preferred an OCR guess over the catalogue that
    // said Latin, one because IA's record is simply wrong. The SOURCE_LANG guard
    // inside the matcher reads this field, so a mislabel silently changes the
    // verdict. Prefer original_language (set from the work, not the scan) and
    // record which one we used so the card can be re-judged later.
    const langUsed = b.original_language || b.language || null;
    const langTrusted = !!b.original_language;
    const bForMatch = { ...b, language: langUsed };
    const m = matchBookToCatalog(bForMatch, bySurname);
    if (m && m.tier === 'demote_candidate') {
      decisions.push({ book: b, action: 'SET_prior_exists', match: m.best_match, detail: `${m.match_count} catalogue match(es), all guards pass` });
      continue;
    }
    if (m) {
      // Matched on author+title but a guard fired — anthology/study, partial,
      // wrong source language, volume or namesake mismatch. Exactly the
      // Godwin-monograph shape. Not a prior, but not clean absence either.
      decisions.push({ book: b, action: 'HOLD_guard_fired', match: m.best_match, detail: `guards failed: ${m.best_match.failed_guards.join(', ')}` });
      continue;
    }

    const s = await searchPriorTranslations(bForMatch);
    if (!s.ran) {
      decisions.push({ book: b, action: 'HOLD_unsearchable', detail: s.reason, search: s });
    } else if (s.decisive_hits.length) {
      decisions.push({ book: b, action: 'HOLD_candidate_found', detail: `${s.decisive_hits.length} English candidate(s) need a page read before any claim`, search: s });
    } else if (!s.decisive_complete) {
      decisions.push({ book: b, action: 'HOLD_source_down', detail: `unchecked: ${s.decisive_unchecked.join(', ')}`, search: s });
    } else {
      decisions.push({ book: b, action: 'SET_no_prior_known', detail: `catalogue miss + no English edition in ${s.sources.length} sources${langTrusted ? '' : ' (language unverified — matched on the scan label)'}`, search: s, langUsed, langTrusted });
    }
  }

  // ── report ────────────────────────────────────────────────────────────────
  const tally = {};
  for (const d of decisions) tally[d.action] = (tally[d.action] ?? 0) + 1;
  log(`Phase 7.7 — prior-translation check [${apply ? 'APPLY' : 'DRY RUN'}]`);
  log(REFERENCE_SET);
  log(`candidates: ${candidates.length}${collection ? ` in "${collection}"` : ''}`);
  for (const d of decisions) {
    log(`  ${d.action.padEnd(20)} ${String(d.book.language ?? '?').padEnd(9)} ${String(d.book.display_title || d.book.title).slice(0, 50)}`);
    log(`      ${d.detail}`);
    if (d.match) log(`      -> "${String(d.match.english_title ?? d.match.canonical_work ?? '?').slice(0, 56)}" — ${d.match.translator ?? '?'} ${d.match.year ?? '?'} [${d.match.completeness ?? '?'}]`);
    if (d.search?.ran) {
      for (const src of d.search.sources) log(`        ${src}`);
      for (const h of d.search.decisive_hits.slice(0, 3)) log(`        CANDIDATE "${String(h.english_title).slice(0, 52)}" ${h.year ?? ''} [${h.found_in}]`);
    }
  }
  const summary = Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ');
  log(`\n${summary}`);

  if (!apply) {
    log('Dry run — nothing written.');
    return { written: 0, summary, decisions };
  }

  const { recordSweepAction } = await import('../lib/sweep-log.mjs');
  let written = 0;
  let skippedRace = 0;
  for (const d of decisions) {
    if (d.action.startsWith('SKIP')) continue;
    const now = new Date();
    // The search record IS the claim. Name every source that answered and every
    // one that did not, so the negative shows its own edges.
    const searchSummary = d.search?.ran
      ? `Prior-translation check ${now.toISOString().slice(0, 10)} (${STAMP}). Tier 0: author+title against ${REFERENCE_SET} — no match. Tier 1, queried as "${d.search.author} / ${d.search.tokens.join(' ')}": ${d.search.sources.join(' · ')}.${d.search.unchecked.length ? ` UNCHECKED: ${d.search.unchecked.join(', ')}.` : ''} Deterministic API queries; no model judgement. Absence is absence from these sources.`
      : `Prior-translation check ${now.toISOString().slice(0, 10)} (${STAMP}): author+title against ${REFERENCE_SET}. Deterministic; no model judgement.`;

    const review = { verified_by: STAMP, verified_at: now.toISOString(), notes: d.detail };
    let status;
    let entries;
    if (d.action === 'SET_prior_exists') {
      status = 'prior_exists';
      entries = [{
        kind: 'english_translation',
        year: d.match.year ?? null,
        translator: d.match.translator ?? null,
        title: d.match.english_title ?? d.match.canonical_work ?? null,
        publisher: d.match.publisher ?? null,
        completeness: d.match.completeness ?? null,
        citation_url: d.match.citation_url ?? d.match.url ?? null,
        verified: false,                       // catalogue-derived, not page-read
        source_methods: [STAMP],
      }];
    } else if (d.action === 'SET_no_prior_known') {
      status = 'no_prior_known';
    } else {
      status = 'under_review';
      review.identity_flag = true;
      if (d.search?.decisive_hits?.length) review.candidates = d.search.decisive_hits.slice(0, 5);
    }

    const stage = {
      _id: d.book.work_id, work_id: d.book.work_id,
      work_title: d.book.display_title || d.book.title, author: d.book.author ?? null,
      status,
      review: { $mergeObjects: [{ $ifNull: ['$review', {}] }, review] },
      // searchRecordLine() renders from STRUCTURED fields — it returns null
      // unless `attempt_count > 0`, and lists `sources` and `last_searched`.
      // Writing only a prose `summary` produced a live card that asserted a
      // possible first with NO search record beneath it: the claim without its
      // evidence, which is the one shape this whole design exists to avoid.
      // Verified on /book/summula-confessionis-antonino before this was added.
      search: { $mergeObjects: [{ $ifNull: ['$search', {}] }, {
        summary: searchSummary,
        attempt_count: d.search?.ran ? d.search.sources.length + 1 : 1,   // +1 for the catalogue tier
        sources: d.search?.ran
          ? ['translation_catalogs', ...d.search.sources.map((s) => s.split(' —')[0].replace(' [advisory]', ''))]
          : ['translation_catalogs'],
        last_searched: now.toISOString(),
      }] },
      updated_at: now,
    };
    if (entries) stage.entries = entries;

    // The filter deliberately refuses to touch a settled card. With upsert that
    // means a card settled since we read it makes Mongo attempt an INSERT and
    // collide on _id — which is the correct outcome (do not overwrite), so the
    // collision is caught and counted, never allowed to abort the batch.
    let res;
    try {
      res = await cards.updateOne(
        { _id: d.book.work_id, status: { $in: ['under_review', null] } },
        [{ $set: stage }],
        { upsert: true },
      );
    } catch (e) {
      if (e?.code === 11000) { skippedRace++; continue; }
      throw e;
    }
    if (res.modifiedCount === 1 || res.upsertedCount === 1) {
      written++;
      await recordSweepAction(db, {
        script: 'prior-translation-check.mjs', issue: '#4617',
        collection: 'work_translation_history', target: d.book.work_id,
        action: d.action, detail: d.detail,
      }).catch(() => {});
    }
  }
  log(`APPLIED: ${written} cards written${skippedRace ? `, ${skippedRace} skipped (settled by another writer first)` : ''} (guard: only unsettled cards touched)`);
  return { written, summary, decisions };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const arg = (k, d = null) => {
    const hit = argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.split('=').slice(1).join('=') : d;
  };
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    await runPriorTranslationCheck({
      db: client.db('bookstore'),
      limit: parseInt(arg('limit', '50'), 10),
      collection: arg('collection'),
      book: arg('book'),
      apply: argv.includes('--apply'),
    });
  } finally {
    await client.close();
  }
}
