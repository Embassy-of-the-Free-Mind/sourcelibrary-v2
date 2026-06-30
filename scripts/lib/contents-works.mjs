// contents-works.mjs — the contents-manifest layer (#2913 / #2916).
//
// Two relations, do NOT conflate (see .claude/docs/title-and-work-identity-principles.md, Set F):
//   • `work_id` (clustering)    — groups editions+translations of ONE work; ≤ books.
//   • the work COUNT (this file) — curatorial tally of distinct works; ≥ books (book-floored).
//
// A book is AT LEAST one work (grain policy #2909). A *container* book carries
// several works in `contents_works[]`. This module is the single source of truth
// for (a) deriving that manifest from the existing `books.chapters[]` index — free,
// no AI — and (b) the canonical book-floored count.
//
// Provenance/confidence ride on every entry so consumers can filter provisional
// (chapter-derived, unverified) from authoritative (ft-verify'd). Per the grain
// policy the COUNT is never `distinct work_id`, and is asserted ≥ books.

// Title signals that a book is a multi-work container (mirrors the #2914 estimator).
export const CONTAINER_RE = /\b(collected works|complete works|collected|selected works|anthology|miscellany|compilation|omnibus|works of|writings of|various|samhita|collection|opera omnia|sammlung)\b/i;
export const AUTHOR_CONTAINER_RE = /various|multiple|anonymous|collective/i;

// Generic section / apparatus titles that are NOT distinct works.
const GENERIC_RE = /^\s*(capitulum|caput|chapter|kapitel|chap|part|pars|liber|book|buch|tomus|vol|section|§|canto|sectio|cap\.?|chapitre)\s*[ivxlcdm0-9.]*\s*$|^\s*[ivxlcdm0-9.]+\s*$|^(vorrede|preface|vorwort|introduction|einleitung|index|register|title|titlepage|titelblatt|inhalt|contents|appendix|errata|colophon|dedication|widmung|frontispiece|prologue|prologus|epilogue|notes|bibliography)\b/i;

/** True if the book's title/author carry a container signal. */
export function isContainerSignal(book) {
  return CONTAINER_RE.test(book.title || '') || AUTHOR_CONTAINER_RE.test(book.author || '');
}

/**
 * Derive the constituent works of a container from its `books.chapters[]` index.
 * The LEVEL-1 chapters with distinct, non-generic titles ARE the constituent works.
 * Returns [] when there are no chapters (route those to AI extraction — #2913 Phase 3).
 *
 * Each entry: { title, page_from, page_to } — the raw manifest. `confidence`,
 * `provenance`, `source_language`, `work_id`, `is_first_translation`, `verified`
 * are layered on by the seeder (they are catalog state, not derivation output).
 */
export function deriveContentsWorks(book) {
  const chs = book.chapters || [];
  if (!chs.length) return [];
  const top = Math.min(...chs.map((c) => c.level ?? 1));
  const seen = new Set();
  const out = [];
  for (const c of chs) {
    if ((c.level ?? 1) !== top) continue;
    const t = (c.titleEn || c.title || '').trim();
    if (!t || GENERIC_RE.test(t)) continue;
    const k = t.toLowerCase().slice(0, 40);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      title: t,
      title_en: c.titleEn && c.titleEn !== c.title ? c.titleEn : null,
      page_from: Number(c.pageNumber) || null,
      page_to: Number(c.endPage) || Number(c.pageNumber) || null,
    });
  }
  return out;
}

/**
 * Validate a derived manifest against the book's pages (two honest signals):
 *  - reach: max endPage across ALL chapters / pages_count — does the chapter INDEX
 *           span the whole book? (low reach ⇒ truncated index = real gap).
 *  - thin:  constituents whose extent (start_i → next level-1 start) is <2pp —
 *           likely a section-head mis-leveled as a work (over-count).
 * NB: a level-1 chapter's own `endPage` stops before its level-2 children, so we
 * tile by next-start, not stored endPage (which under-reports and is sometimes
 * malformed start>end). Matches the #2914 estimator.
 */
export function validateManifest(constituents, allChapters, pagesCount) {
  const reach = pagesCount
    ? Math.min(1, Math.max(0, ...allChapters.map((c) => Number(c.endPage) || Number(c.pageNumber) || 0)) / pagesCount)
    : null;
  const starts = constituents.map((c) => c.page_from).filter((n) => n).sort((a, b) => a - b);
  const thinIdx = new Set();
  for (let i = 0; i < starts.length; i++) {
    const extent = (i + 1 < starts.length ? starts[i + 1] : (pagesCount || starts[i] + 2)) - starts[i];
    if (extent < 2) thinIdx.add(starts[i]);
  }
  return { reach, thinStarts: thinIdx, thin: thinIdx.size };
}

/**
 * Per-constituent confidence in [0,1]: anchored by the book's index reach, with a
 * penalty for thin (likely mis-leveled) entries. A coarse but honest signal that
 * lets the count/holdings consumers filter the weakest provisional rows.
 */
export function entryConfidence({ reach, isThin }) {
  let c = reach == null ? 0.5 : Math.max(0, Math.min(1, reach));
  if (isThin) c *= 0.4;
  return +c.toFixed(2);
}

/**
 * THE CANONICAL COUNT (#2913). Book-floored work count over the FT-eligible set.
 *
 * Per the grain policy (Set F): count = Σ over books of max(1, qualifying
 * constituents). Every book contributes ≥1 (the floor); a container contributes
 * its decomposed works instead. The result is ALWAYS ≥ books — asserted by callers.
 *
 * modes:
 *   'verified'    — only constituents that are individually FT-verified count above
 *                   the floor (`is_first_translation === true && verified === true`).
 *                   This is the HONEST, surfaceable number. With nothing verified yet
 *                   it equals the book count — and rises as the ft-verify pass lands.
 *   'provisional' — every chapter-derived constituent counts (max(1, contents_works.length)).
 *                   An UPPER BOUND on first-translated works, not a fact — for internal
 *                   sizing only, never the public headline until verified.
 *
 * `dupRecords` is the only downward correction (exact duplicate *records* — the same
 * single edition catalogued twice). NOT multi-volume sets, NOT multi-edition holdings.
 * Defaults to 0 (we do not auto-detect it here).
 */
export function countFirstTranslatedWorks(ftBooks, { mode = 'verified', dupRecords = 0 } = {}) {
  let count = 0;
  for (const b of ftBooks) {
    const cw = Array.isArray(b.contents_works) ? b.contents_works : [];
    if (mode === 'provisional') {
      count += Math.max(1, cw.length);
    } else {
      const verified = cw.filter((e) => e.is_first_translation === true && e.verified === true);
      count += Math.max(1, verified.length);
    }
  }
  count -= Math.max(0, dupRecords);
  // Hard invariant: the count is book-floored (minus only true duplicate records).
  if (count < ftBooks.length - Math.max(0, dupRecords)) {
    throw new Error(`countFirstTranslatedWorks: ${count} < book floor ${ftBooks.length} — clustering was conflated with counting`);
  }
  return count;
}
