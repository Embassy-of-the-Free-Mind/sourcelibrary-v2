/**
 * Publication-date hygiene for citations and display.
 *
 * `books.published` is FREE TEXT (see CLAUDE.md). Across the visible corpus,
 * 23% of it is not a year: literal "Unknown", empty strings, century labels
 * ("15th century"), ranges ("between 1650 and 1700"), and — for ~1,500 books
 * imported from Wikidata — raw QuickStatements syntax that was never meant to
 * be read by a human:
 *
 *     "1573date QS:P571,+1573-00-00T00:00:00Z/9"
 *
 * That string was being emitted verbatim as `citation_publication_date`, as the
 * BibTeX `year` field, and inside `og:title` — so a scholar pasting our BibTeX
 * got machine noise in their bibliography, and every social share of those
 * books carried it in the headline.
 *
 * Two different questions, two functions:
 *   - What may we SHOW a reader?  -> displayPublished(): keep informative
 *     hedged forms ("15th century", "circa 1700"), drop noise and non-answers.
 *   - What may we ASSERT to a machine? -> citationYear(): a bare year only.
 *     A century or a range is genuine knowledge but it is NOT a publication
 *     date, and citation fields have no way to express the uncertainty — so we
 *     emit nothing rather than flatten "15th century" into a false "1450".
 *
 * Deliberately NOT falling back to the numeric `books.year`: that field is
 * derived and sometimes an import placeholder (see #3307 — 1,446 undated
 * Bhutanese manuscripts stamped `year: 1700`). Keying the citation strictly off
 * `published` means correcting the source field is sufficient to stop the claim.
 */

/**
 * Wikidata QuickStatements tail: everything from "date QS:" onward.
 *
 * `[\s\S]` rather than `.` with the `s` flag — tsconfig targets ES2017, where
 * dotAll is not available (TS1501), and this file is imported by the book page.
 */
const QUICKSTATEMENTS_TAIL = /date\s*QS:[\s\S]*$/i;

/** Values that assert "we do not know" — never worth showing or citing. */
const NOT_A_DATE = /^(unknown(\s+date)?|undated|no\s+date|n\.?\s*d\.?|s\.?\s*d\.?|date\s+of\s+publication\s+not\s+identified|not\s+identified|none|null)$/i;

/** A bare year, 3-4 digits. The only form safe to assert as a date. */
const BARE_YEAR = /^\d{3,4}$/;

/**
 * Reader-facing publication string, or null if there is nothing worth showing.
 * Keeps hedged-but-informative values ("15th century", "circa 1700",
 * "between 1650 and 1700"); strips QuickStatements noise and non-answers.
 */
export function displayPublished(raw?: string | null): string | null {
  if (raw == null) return null;
  const stripped = String(raw).replace(QUICKSTATEMENTS_TAIL, '').replace(/\s+/g, ' ').trim();
  if (!stripped) return null;
  // Compare unbracketed/unpunctuated so "[Unknown]" and "n.d." are caught too.
  const bare = stripped.replace(/[[\]().]/g, '').replace(/\s+/g, ' ').trim();
  if (!bare || NOT_A_DATE.test(bare)) return null;
  return stripped;
}

/**
 * Year safe to put in a machine-readable citation field
 * (`citation_publication_date`, BibTeX `year`), or null.
 *
 * Only a bare year qualifies. Centuries, ranges and "circa" values are real
 * knowledge but not publication dates — asserting one would fabricate a
 * precision the source never had.
 */
export function citationYear(published?: string | null): string | null {
  const display = displayPublished(published);
  if (!display) return null;
  // Bracketed conjecture from library cataloguing ("[1620]") is still a year.
  const unbracketed = display.replace(/^\[|\]$/g, '').trim();
  return BARE_YEAR.test(unbracketed) ? unbracketed : null;
}

/**
 * Year for a BibTeX entry, with the no-date convention scholars expect.
 * BibTeX has no "unknown" — `n.d.` is the standard stand-in.
 */
export function citationYearOrNd(published?: string | null): string {
  return citationYear(published) ?? 'n.d.';
}
