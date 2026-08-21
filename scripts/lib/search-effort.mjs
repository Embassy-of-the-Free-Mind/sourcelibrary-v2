/**
 * search-effort.mjs — make the SEARCH itself the citable artifact. (#3459)
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * "First English translation" asserts an unprovable universal negative. No
 * search can establish it; a catalogue returns only *nothing found*. Every
 * attempt to shore the claim up with better evidence has failed the same way,
 * because the claim's SHAPE is wrong, not its evidence quality.
 *
 * The move is to stop claiming the negative and start publishing the search.
 * Instead of "this is the first English translation", say:
 *
 *   "No prior English translation found. Searched 4 catalogues (14.2M records,
 *    snapshots 2016–2026); 31 candidates screened; 2026-07-30. [see the record]"
 *
 * That is a claim about a *specific, bounded, reproducible act*, and it is TRUE
 * — verifiably, by a third party, forever. It is also strictly more informative
 * than the bare assertion, because it shows its own edges.
 *
 * WHAT MAKES AN EFFORT REPRODUCIBLE
 * ---------------------------------
 * Five things, and dropping any one breaks it:
 *
 *   1. The PROPOSITION, stated exactly. "Does a complete English translation of
 *      <work> published before <year> exist?" — not "is this a first?"
 *   2. The REFERENCE SET, with per-source snapshot dates, record counts, and
 *      declared gaps. Absence means absence FROM THIS SET; a set that cannot
 *      state its own boundary cannot support a negative at all.
 *   3. Every QUERY VERBATIM, replayable. Not "we searched LoC" — the actual
 *      query string, and the count it returned.
 *   4. Every CANDIDATE retrieved, with its screening decision AND the reason.
 *      The rejects matter more than the accepts: they are what shows the search
 *      was real rather than a lookup that happened to miss.
 *   5. The CODE VERSION (git SHA). Measured on 2026-07-29: a one-line change to
 *      the direction of a title-coverage ratio moved strong matches from 8 to
 *      74 over identical data. Same corpus, same book, 9x different answer. An
 *      effort that does not pin its code is not reproducible, it is an anecdote.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It never sets `books.is_first_translation`. An effort is EVIDENCE; the verdict
 * stays derived and behind the sign-off-gated reconcile (#2933). Recording an
 * effort must never be able to flip a public badge on its own — that separation
 * is what makes it safe to run the sweep at corpus scale.
 */

import crypto from 'crypto';

/** Screening outcomes for a retrieved candidate. */
export const SCREEN = {
  PRIOR: 'prior_translation',        // a complete English translation of THIS work, earlier
  PARTIAL: 'partial_translation',    // selections/excerpts — does not defeat "first complete"
  DIFFERENT_WORK: 'different_work',  // same author, different work
  NOT_A_TRANSLATION: 'not_a_translation', // a study/commentary about the text (#3428)
  WRONG_LANGUAGE: 'wrong_language',  // a translation, but not into English / not from our source
  LATER: 'later_than_ours',          // a real English translation, but published after ours
  UNRESOLVED: 'unresolved',          // could not decide — counts AGAINST confidence
};

/** Outcomes that defeat a first-complete-translation claim. */
const DEFEATING = new Set([SCREEN.PRIOR]);

/**
 * Verdicts. Note there is no "confirmed first" — that is the unprovable claim.
 * The strongest available verdict is `none_found`, which is a statement about
 * the search, not about the world.
 */
export const VERDICT = {
  NONE_FOUND: 'none_found',
  PRIOR_FOUND: 'prior_found',
  ONLY_PARTIAL_FOUND: 'only_partial_found',
  NOT_SEARCHABLE: 'not_searchable',  // no access point existed — we could not ask
  INCONCLUSIVE: 'inconclusive',
};

/**
 * Stable, citable id. Deterministic in its inputs so re-running the same effort
 * over the same reference-set version yields the same id (idempotent upsert),
 * while a new snapshot or new code version yields a new one — which is correct:
 * that IS a different search.
 */
export function effortId({ bookId, referenceSetVersion, codeVersion }) {
  const digest = crypto
    .createHash('sha1')
    .update([bookId, referenceSetVersion, codeVersion].join('|'))
    .digest('hex')
    .slice(0, 8);
  return `SE-${bookId}-${referenceSetVersion}-${digest}`;
}

/**
 * Derive the verdict from the screened candidates.
 *
 * Deliberately mechanical — the judgement lives in the per-candidate screening,
 * where the evidence is, not in a second layer of inference on top of it. If a
 * candidate is unresolved, the effort cannot claim `none_found`: an unscreened
 * candidate is an open question, and rounding it down to "nothing found" is
 * exactly the false confidence this whole design exists to remove.
 */
export function deriveVerdict({ candidates, searchable }) {
  // `searchable` describes the CATALOGUES: did this book have an author, title or
  // original-script access point we could query? A book can fail that and still
  // produce candidates, because some sources are joined rather than searched —
  // our own `translation_classification` is keyed on book id, so it answers for a
  // book no catalogue index can reach. Returning NOT_SEARCHABLE there would
  // discard a real prior lead in favour of "we could not ask", which is the
  // confident-negative failure this design exists to prevent. No access point AND
  // nothing retrieved is the only true "could not ask".
  if (!searchable && !candidates.length) return VERDICT.NOT_SEARCHABLE;
  if (candidates.some((c) => DEFEATING.has(c.screen))) return VERDICT.PRIOR_FOUND;
  if (candidates.some((c) => c.screen === SCREEN.UNRESOLVED)) return VERDICT.INCONCLUSIVE;
  if (candidates.some((c) => c.screen === SCREEN.PARTIAL)) return VERDICT.ONLY_PARTIAL_FOUND;
  return VERDICT.NONE_FOUND;
}

/**
 * Build a search-effort document.
 *
 * @param {object} p
 * @param {string} p.bookId
 * @param {string} [p.workId]
 * @param {string} p.proposition        the exact question tested, in words
 * @param {object} p.referenceSet       {version, sources:[{id,name,snapshot_date,record_count,coverage,known_gaps[]}]}
 * @param {Array}  p.queries            [{source, query, url?, result_count}]
 * @param {Array}  p.candidates         [{bib_record_key?, identifiers, title, year, screen, reason, score?}]
 * @param {boolean} p.searchable        false when no access point existed
 * @param {string} p.codeVersion        git SHA of the code that ran this
 * @param {string[]} [p.limitations]    what this search structurally cannot see
 */
export function buildSearchEffort(p) {
  const {
    bookId, workId, proposition, referenceSet, queries = [], candidates = [],
    searchable = true, codeVersion, limitations = [], runAt = new Date(),
  } = p;

  if (!bookId) throw new Error('buildSearchEffort: missing bookId');
  if (!proposition) throw new Error('buildSearchEffort: missing proposition');
  if (!codeVersion) throw new Error('buildSearchEffort: missing codeVersion — an unpinned effort is not reproducible');
  if (!referenceSet?.version || !Array.isArray(referenceSet.sources) || !referenceSet.sources.length) {
    throw new Error('buildSearchEffort: referenceSet needs a version and at least one source');
  }
  for (const s of referenceSet.sources) {
    if (!s.snapshot_date) {
      throw new Error(`buildSearchEffort: source "${s.id}" has no snapshot_date — a set with no date cannot bound a negative`);
    }
  }

  const verdict = deriveVerdict({ candidates, searchable });

  // Every source's declared gaps become limitations of THIS effort. A gap named
  // once in a manifest and never surfaced on the claim it undermines is not a
  // disclosure, it is a footnote nobody reads.
  const inheritedLimitations = referenceSet.sources.flatMap((s) =>
    (s.known_gaps ?? []).map((g) => `${s.id}: ${g}`));

  return {
    effort_id: effortId({ bookId, referenceSetVersion: referenceSet.version, codeVersion }),
    book_id: bookId,
    work_id: workId ?? null,

    proposition,
    verdict,
    searchable,

    reference_set: referenceSet,
    queries,
    candidates,

    counts: {
      queries: queries.length,
      records_returned: queries.reduce((n, q) => n + (q.result_count ?? 0), 0),
      candidates_screened: candidates.length,
      by_screen: candidates.reduce((acc, c) => {
        acc[c.screen] = (acc[c.screen] || 0) + 1;
        return acc;
      }, {}),
    },

    limitations: [...new Set([...limitations, ...inheritedLimitations])],
    code_version: codeVersion,
    run_at: runAt,
  };
}

/**
 * Reduce a raw `search_efforts` read to the CURRENT generation: the latest
 * effort per book.
 *
 * Efforts are immutable by design — a new code version or reference-set snapshot
 * mints a new `effort_id` instead of overwriting, which is exactly what lets a
 * previously-asserted negative be re-opened when the reference set grows. The
 * cost is that the collection is a HISTORY, not a state, and a naive
 * `find({verdict:'inconclusive'})` mixes verdicts produced by superseded,
 * buggier matchers with current ones.
 *
 * That is not hypothetical: it returned 265 inconclusive efforts against a
 * current generation of 75, i.e. 190 rows of stale judgement that would have been
 * screened and reported as if live. Any consumer reading this collection must
 * reduce through here first.
 */
export function latestEffortPerBook(efforts) {
  const best = new Map();
  for (const e of efforts) {
    if (!e?.book_id) continue;
    const prev = best.get(e.book_id);
    if (!prev || new Date(e.run_at) > new Date(prev.run_at)) best.set(e.book_id, e);
  }
  return [...best.values()];
}

/**
 * One-line, reader-facing summary of an effort — what the badge renders instead
 * of an unprovable claim.
 */
export function renderEffortSummary(effort) {
  if (effort.verdict === VERDICT.NOT_SEARCHABLE) {
    return 'Not yet searchable — no catalogue access point for this work.';
  }
  const sources = effort.reference_set.sources;
  const records = sources.reduce((n, s) => n + (s.record_count ?? 0), 0);
  const dates = sources.map((s) => String(s.snapshot_date).slice(0, 4)).sort();
  const span = dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]}–${dates[dates.length - 1]}`;
  const scope = `Searched ${sources.length} ${sources.length === 1 ? 'catalogue' : 'catalogues'}`
    + `${records ? ` (${records.toLocaleString()} records, ${span})` : ''}`
    + `; ${effort.counts.candidates_screened} candidate${effort.counts.candidates_screened === 1 ? '' : 's'} screened`
    + `; ${new Date(effort.run_at).toISOString().slice(0, 10)}.`;

  switch (effort.verdict) {
    case VERDICT.NONE_FOUND:
      return `No prior English translation found. ${scope}`;
    case VERDICT.ONLY_PARTIAL_FOUND:
      return `No prior COMPLETE English translation found; earlier selections exist. ${scope}`;
    case VERDICT.PRIOR_FOUND:
      return `A prior English translation exists. ${scope}`;
    default:
      return `Inconclusive — candidates remain unscreened. ${scope}`;
  }
}

/**
 * effortToAttempt — the ONE-LEDGER bridge (#3881 pass 1).
 *
 * `first_translation_attempts` is the canonical evidence ledger; this
 * collection is the tier-1 DETAIL ARCHIVE behind it (the same relationship
 * `first_translation_transcripts` has to rung-2 skeptic rows: ledger row lean,
 * deep artifact separate). Every searchable effort therefore also lands in the
 * ledger as one compact attempt row, produced here, with `transcript_ref`
 * pointing back at the effort for the full queries/candidates/screening record.
 *
 * NOT_SEARCHABLE efforts return null on purpose: "we could not ask" must never
 * enter the ledger, where downstream readers treat a row as "we asked" — the
 * exact conflation the invariant doc forbids.
 */
export function effortToAttempt(effort) {
  if (!effort || effort.verdict === VERDICT.NOT_SEARCHABLE) return null;

  const candidates = effort.candidates ?? [];
  const priorRows = candidates.filter((c) => c.screen === SCREEN.PRIOR);
  const partialRows = candidates.filter((c) => c.screen === SCREEN.PARTIAL);
  const citeUrl = (c) => {
    const id = c.identifiers ?? {};
    if (id.lccn) return `https://lccn.loc.gov/${id.lccn}`;
    if (id.estc_id) return `http://estc.bl.uk/${id.estc_id}`;
    if (id.wikidata_edition) return `https://www.wikidata.org/wiki/${id.wikidata_edition}`;
    return undefined;
  };
  const toPrior = (c, completeness) => ({
    english_title: c.title,
    pub_year: c.year != null ? String(c.year) : undefined,
    publisher: c.publisher,
    completeness,
    source_url: citeUrl(c),
  });

  const found = effort.verdict === VERDICT.PRIOR_FOUND || effort.verdict === VERDICT.ONLY_PARTIAL_FOUND;
  return {
    // Deterministic: an effort maps to exactly one attempt, so re-ingesting a
    // generation is idempotent under appendAttempt's $setOnInsert.
    attempt_id: `${effort.book_id}:tier1_catalog:${effort.effort_id}`,
    book_id: effort.book_id,
    work_id: effort.work_id ?? null,
    date: new Date(effort.run_at).toISOString(),
    method: 'tier1_catalog',
    match_key: effort.work_id ? 'work_id' : 'author_title',
    sources_checked: (effort.reference_set?.sources ?? []).map((s) => s.id),
    queries: (effort.queries ?? []).map((q) => `[${q.source}] ${q.query} → ${q.result_count ?? 0}`),
    result: found ? 'found' : 'none',
    verdict: effort.verdict,
    found_refs: priorRows.concat(partialRows)
      .map((c) => c.identifiers?.lccn ?? c.identifiers?.estc_id ?? c.identifiers?.wikidata_edition)
      .filter(Boolean),
    priors: [
      ...priorRows.map((c) => toPrior(c, 'complete')),
      ...partialRows.map((c) => toPrior(c, 'partial')),
    ],
    // A positive sighting in a curated catalogue is strong; catalogue-tier
    // absence is weak BY MEASUREMENT (32.1% recall) — never higher.
    evidence_strength: effort.verdict === VERDICT.PRIOR_FOUND ? 'strong'
      : effort.verdict === VERDICT.ONLY_PARTIAL_FOUND ? 'moderate'
      : 'weak',
    notes: renderEffortSummary(effort),
    prompt_version: `ft-reference-set-search/${effort.reference_set?.version ?? 'unknown'}@${effort.code_version ?? 'unknown'}`,
    transcript_ref: effort.effort_id,
    _src: 'search_efforts',
  };
}
