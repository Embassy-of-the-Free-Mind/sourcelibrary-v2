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

/**
 * Titles of the genres where a personal name printed inside the book is evidence
 * of MENTION, not authorship: bookseller/auction/library catalogues, banned-book
 * lists, accession registers, bibliographic periodicals.
 *
 * Deliberately anchored at the start of the title — a catalogue announces itself
 * in its first words ("Catalogus librorum…", "Verzeichniß von…"). A mid-title
 * match would sweep in every work that merely cites a catalogue.
 */
export const REFERENCE_GENRE_TITLE_RE =
  /^\s*[\[(]?\s*(catalog(ue|us|o|i)?\b|catalogv|index librorum\b|verzeichni|b(ü|u)cher-?verzeichni|katalog|nachrichten von\b|nachtrag zu dem catalog|supplementum ad catalog|allgemeiner anzeiger\b|bibliotheca(e)?\s+(heinsiana|nicolaiana|fratrum|samuelis|a\s|d[eu]\s))/i;

/** Does this title announce itself as a catalogue / reference list? */
export function isReferenceGenreTitle(title) {
  return REFERENCE_GENRE_TITLE_RE.test(String(title ?? ''));
}

/**
 * The #3434 class: a name that appears INSIDE a later book promoted to its author.
 *
 * `authorshipPlausible` above deliberately refuses to exclude on the death side,
 * and that refusal is correct for editions — a 1925 Boethius is a reprint, not a
 * misattribution, and Boethius alone carries 55 such books. But it is the wrong
 * rule for a *catalogue*: a 1762 Habsburg banned-book list is not an edition of a
 * Khunrath work, it is a list that happens to name him. So the death-side signal
 * only becomes usable when combined with the genre of the containing book.
 *
 * Both conditions are required, and even then this is a REVIEW signal, not a
 * verdict — a genuine posthumous collected edition can carry a catalogue-shaped
 * title (Diodorus Siculus' own *Bibliotheca Historica*; the *Bibliotheca Fratrum
 * Polonorum*). Callers must not auto-write from it.
 *
 * @param margin  years after death still treated as a plausible edition window.
 *                Generous by design: precision here comes from the genre test,
 *                not from shaving the margin.
 * @returns {{ suspect: boolean, reason: string }}
 */
export function posthumousMisattributionLikely({ bookYear, deathYear, title, margin = 50 }) {
  if (bookYear == null) return { suspect: false, reason: 'no book year' };
  if (deathYear == null) return { suspect: false, reason: 'no author death year' };
  if (bookYear <= deathYear + margin) {
    return { suspect: false, reason: `book ${bookYear} within ${margin}y of death ${deathYear}` };
  }
  if (!isReferenceGenreTitle(title)) {
    return { suspect: false, reason: 'postdates death but not a reference-genre title (likely a reprint)' };
  }
  return {
    suspect: true,
    reason: `reference-genre title published ${bookYear}, ${bookYear - deathYear}y after author death ${deathYear}`,
  };
}
