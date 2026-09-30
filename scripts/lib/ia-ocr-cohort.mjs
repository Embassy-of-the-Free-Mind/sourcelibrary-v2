// PRIOR ART: scripts/lib/ia-ocr-gate.mjs — the per-language BOOK gate (agreement cutoff), which
// this does not replace: a book must still pass it. This is the PAGE gate that #5124 measured the
// need for; nothing in scripts/lib judged a single leaf's text by year, numbers or script.
// scripts/eval/en-ocr-reference-5124.mjs has the measurement's number test (`isNum`), inline and
// scoped to the reference body, not to an Archive leaf with its running head.
//
// ia-ocr-cohort — which ENGLISH pages the free IA lane may fill with the Archive's own OCR.
//
// Measured on 122 proofread English reference pages (#5124, PR #5216; report
// scripts/eval/results/en-ocr-ref-5124/report.md): flash-lite beats the Archive's text on the same
// page 57/5/43, and the Archive silently misreads ~1.5% of printed numbers ("5180 years" → 6180;
// the #5186 county histories read 1836 as 1886) where lite made none. A word-agreement gate cannot
// see this: "1886" is a perfectly good word. Derek adopted the proposed routing on 2026-09-30:
//
//   1. Lite stays the default. No date-dense Archive cohort.
//   2. English pages MAY take the Archive's text only when the book was published 1880–1930, the
//      leaf carries no number of two or more digits (the printed page number excepted, below), and
//      ≥ 90% of its letters are Latin script (one reference page was English OCR'd as Greek).
//      Archive CER there was 0.62% against lite's 0.34%, and there is no number to get wrong.
//   3. On a page the OCR lane refused as RECITATION, the Archive's text is written instead of
//      nothing — whatever the year or numbers. The script test still applies.
//   4. Pre-1880 is not earned (Archive 6.6% vs lite 1.5% CER).
//
// Other languages are NOT gated here: #5124 measured English only, so French, Latin, German and
// Italian keep the book-level policy in ia-ocr-gate.mjs until they are measured the same way.
//
// THE PAGE NUMBER. Almost every leaf prints its folio ("12 HISTORY OF BARNSTABLE COUNTY."), so a
// literal "no 2–4-digit number" test would refuse nearly every page past page 9. The rule's
// reference bodies (Wikisource) exclude the running head, so the folio is exempt here too — but
// only when the book's own sequence CONFIRMS it: a number on the first or last line of a leaf
// counts as a folio when a leaf within ±3 carries a number there that runs with it (n+1 on the next
// leaf, n+1 or n+2 two leaves on, allowing an unnumbered plate between). A misread folio (186 →
// 136) does not run with its neighbours, so it stays a number and refuses the page — the exemption
// can only ever be taken by a number the book itself corroborates.
//
// KNOWN BLIND SPOT. A number the Archive read as LETTERS ("551" → "SSI", #5186) has no digits left
// to test. Nothing here catches it; the validation (#5124 thread) measured how often lite reads a
// number on a page this gate admitted.

/** The rule, recorded on every page it admits (`ocr.agreement_ref.page_gate.rule`). */
export const IA_ARCHIVE_COHORT = Object.freeze({
  rule: 'en-1880-1930-numberfree-latin90@5124',
  language: 'English',
  yearMin: 1880,
  yearMax: 1930,
  minLatinShare: 0.9,
  /** Leaves either side searched for a number that runs with a candidate folio. */
  folioWindow: 3,
  /** A running-head / folio line has at most this many words. */
  folioLineMaxWords: 10,
});

/**
 * The publication year from `books.published` (free text — never parseInt it whole) or a numeric
 * `year`. First plausible 4-digit year wins ("1880-1885" → 1880, "c1890" → 1890, "[1917?]" → 1917).
 * `identity-fields.mjs editionYear` needs a word boundary and returns null for "c1890", which would
 * silently drop a book from the cohort; this reads the digits wherever they sit. null = unknown.
 */
export function publicationYear(book) {
  if (typeof book?.year === 'number' && book.year >= 1400 && book.year <= 2100) return book.year;
  const m = String(book?.published ?? '').match(/(?<!\d)(1[4-9]\d\d|20\d\d)(?!\d)/);
  return m ? +m[1] : null;
}

const lines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
const numsOf = (line) => (line.match(/\d+/g) || []).map(Number);

/** Numbers on a leaf's first and last line, when that line is short enough to be a head or foot. */
function folioCandidates(text) {
  const ls = lines(text);
  if (!ls.length) return [];
  const edge = ls.length === 1 ? [ls[0]] : [ls[0], ls[ls.length - 1]];
  return edge.filter((l) => l.split(/\s+/).length <= IA_ARCHIVE_COHORT.folioLineMaxWords).flatMap(numsOf);
}

/**
 * For every leaf of a book, the folio numbers its sequence confirms (see the header). Returns an
 * array of Sets, parallel to `leaves`. Pass the WHOLE book's leaves: confirmation comes from the
 * neighbours, which is why this is computed once per book, not per page.
 */
export function confirmedFolios(leaves) {
  const cands = leaves.map(folioCandidates);
  const W = IA_ARCHIVE_COHORT.folioWindow;
  return cands.map((cs, k) => new Set(cs.filter((n) => {
    for (let d = -W; d <= W; d++) {
      if (!d || !cands[k + d]) continue;
      // Runs with it: same direction as the leaf step, and no further than the leaf step (a plate
      // between two numbered pages consumes a leaf but not a number).
      if (cands[k + d].some((m) => Math.sign(m - n) === Math.sign(d) && Math.abs(m - n) <= Math.abs(d))) return true;
    }
    return false;
  })));
}

/**
 * Numbers of two or more digits on a leaf, after removing ONE occurrence of each confirmed folio.
 * Stricter than "2–4 digits" only in that a 5+-digit run also counts (it is a number to get wrong).
 */
export function pageNumbers(text, folios = new Set()) {
  const nums = (String(text || '').match(/\d{2,}/g) || []).map(Number);
  const exempt = new Set(folios);
  return nums.filter((n) => { if (exempt.has(n)) { exempt.delete(n); return false; } return true; });
}

/** Share of a leaf's letters that are Latin script. 1 for a leaf with no letters (nothing to lose). */
export function latinShare(text) {
  const letters = String(text || '').match(/\p{L}/gu) || [];
  if (!letters.length) return 1;
  return letters.filter((c) => /\p{Script=Latin}/u.test(c)).length / letters.length;
}

/** The OCR lane refused this page as recitation at least once (batch-collector / realtime-ocr stamps). */
export function wasRecitationRefused(page) {
  return (page?.ocr?.recitation_count ?? 0) > 0 || page?.ocr?.recitation_blocked === true
    || page?.ocr?.last_skip?.reason === 'recitation';
}

/**
 * May this page take the Archive's text? `language` is the book's canonical language (as
 * normalizeLanguageToken returns it), `year` from publicationYear(), `text` the Archive leaf,
 * `folios` from confirmedFolios(), `page` the pages row (read for the recitation stamps).
 *
 * Returns `{ admit, admitted_by, reason, numbers, latin_share }`:
 *   admitted_by: 'cohort' | 'recitation_fallback' | 'language_not_gated' (non-English, unchanged)
 *   reason (refused): 'year' | 'numbers' | 'script'
 * `numbers` is the count of non-folio numbers the Archive printed (0 in the cohort; may be > 0 on
 * a fallback page — that page's numbers are unverified, #5186 item 2).
 */
export function archiveCohortDecision({ language, year, text, folios, page }) {
  if (language !== IA_ARCHIVE_COHORT.language) return { admit: true, admitted_by: 'language_not_gated', reason: null, numbers: null, latin_share: null };
  const numbers = pageNumbers(text, folios).length;
  const share = +latinShare(text).toFixed(3);
  const base = { numbers, latin_share: share };
  // Script first: a leaf OCR'd as the wrong script is junk under either admission route.
  if (share < IA_ARCHIVE_COHORT.minLatinShare) return { admit: false, admitted_by: null, reason: 'script', ...base };
  if (wasRecitationRefused(page)) return { admit: true, admitted_by: 'recitation_fallback', reason: null, ...base };
  if (!(year >= IA_ARCHIVE_COHORT.yearMin && year <= IA_ARCHIVE_COHORT.yearMax)) return { admit: false, admitted_by: null, reason: 'year', ...base };
  if (numbers > 0) return { admit: false, admitted_by: null, reason: 'numbers', ...base };
  return { admit: true, admitted_by: 'cohort', reason: null, ...base };
}
