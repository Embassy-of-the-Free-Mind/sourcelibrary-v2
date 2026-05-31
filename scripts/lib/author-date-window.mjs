/**
 * Date-window author disambiguation (GitHub #2250 / #2264).
 *
 * A cheap, deterministic NEGATIVE filter: rule out an author↔book match when the
 * book cannot fall within the author's life window. Used to (a) catch build
 * mis-merges (a church-father's books attributed to Mozart) and (b) gate the ILP
 * variant-enrichment and the work-identity resolver before any LLM/curation step.
 *
 * Asymmetry that matters: publication/edition date ≠ authorship date. A 1925
 * edition of Boethius is fine — so dates exclude reliably only in ONE direction:
 *   - a book printed BEFORE the author was born is impossible (rules them out);
 *   - a book printed long AFTER death is fine (reprints/translations).
 * Therefore this is an exclusion signal, never positive proof of authorship.
 */

/** Parse a Wikidata-style date ("1756-01-27", "-0427", "1498") to a signed year, or null. */
export function parseWikidataYear(s) {
  if (s == null) return null;
  const m = String(s).trim().match(/^(-?)0*(\d{1,4})/);
  if (!m) return null;
  const y = parseInt(m[2], 10);
  if (!Number.isFinite(y) || y === 0) return null;
  return m[1] === '-' ? -y : y;
}

/**
 * Is it plausible that `bookYear` is an edition of a work by an author who lived
 * [birthYear, deathYear]? Returns { plausible, reason }.
 *
 * @param margin  slack (years) absorbing data noise / posthumous-but-near editions.
 *                Only a book predating birth by MORE than `margin` is excluded.
 */
export function authorshipPlausible({ bookYear, birthYear, deathYear, margin = 10 }) {
  if (bookYear == null) return { plausible: true, reason: 'no book year' };
  if (birthYear == null) return { plausible: true, reason: 'no author birth year' };
  if (bookYear < birthYear - margin) {
    return { plausible: false, reason: `book ${bookYear} predates author birth ${birthYear} (>${margin}y)` };
  }
  // Editions after death are expected (reprints/translations) — never excluded here.
  void deathYear;
  return { plausible: true, reason: 'within or after life window' };
}
