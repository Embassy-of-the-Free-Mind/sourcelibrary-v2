/**
 * The copy layer of a citation (#4360).
 *
 * A digitized book is not an edition — it is a COPY: one physical object with
 * a shelfmark, owners, and marginalia. A citation of our scan is therefore a
 * copy-layer claim (see `.claude/docs/invariants/edition-identity.md`), and it
 * has to name the institution whose object was photographed, or copy-specific
 * evidence (a marginal note, a censored line) is uncitable: the note exists in
 * exactly one object, and the reader cannot tell which.
 *
 * The data comes from `book.image_source.contributing_library` / `.shelfmark`.
 * Both are free text with uneven coverage; the backfill and normalization
 * sweep is #4361. This module holds the read-side judgment those citations
 * need today:
 *
 *  - An AGGREGATOR is not a holder. 6,185 live books carry "Internet Archive"
 *    as their contributing library — IA hosted the scan, some other library
 *    owns the book. Emitting "Copy: Internet Archive" would assert a holding
 *    that does not exist, so aggregator names resolve to null (no clause)
 *    until #4361 recovers the real holder from IA's `contributor` field.
 *  - Variant spellings of the same institution get one canonical form, so a
 *    bibliography does not cite "Bayerische Staatsbibliothek" and
 *    "Bayerische Staatsbibliothek (Munich)" as two libraries.
 *
 * Pure string logic, no imports — safe in client components (CiteButton).
 */

/** Hosts and platforms that serve scans but do not hold the physical copy. */
const AGGREGATORS = new Set([
  'internet archive',
  'archive.org',
  'google books',
  'google',
  'project gutenberg',
  'wikimedia commons',
  'wikisource',
  'hathitrust', // aggregator of member-library scans; holder is in member metadata
  // Multi-library national platforms: the platform name tells us the scan's
  // host, not its holder — the true holder needs #4361's per-item metadata.
  'e-rara (swiss electronic library)',
  'e-rara',
]);

/**
 * Canonical citation forms for holders that appear under variant names.
 * Keyed on the lowercased raw value. Kept deliberately small: this is a
 * read-side patch, not the normalization sweep (#4361 writes canonical
 * values onto the rows themselves).
 */
const CANONICAL: Record<string, string> = {
  'bayerische staatsbibliothek': 'Bayerische Staatsbibliothek, Munich',
  'bayerische staatsbibliothek (munich)': 'Bayerische Staatsbibliothek, Munich',
  'bibliotheca philosophica hermetica': 'Bibliotheca Philosophica Hermetica, Amsterdam',
  'british library': 'British Library, London',
  // Gallica is BnF's platform; the holder is the library itself.
  'gallica (bibliothèque nationale de france)': 'Bibliothèque nationale de France, Paris',
  'gallica': 'Bibliothèque nationale de France, Paris',
  'bibliothèque nationale de france': 'Bibliothèque nationale de France, Paris',
};

export interface HoldingCopy {
  /** Canonical institution name, with city where the canonical form carries one. */
  holding_library: string;
  /** Physical shelfmark/classmark in that library, when known. */
  shelfmark?: string;
  /** The rendered clause, without trailing punctuation: `Copy: <library>[, <shelfmark>]`. */
  statement: string;
}

/** `Copy: Bibliotheca Philosophica Hermetica, Amsterdam, PH441` — or null when
 * there is no genuine holder to name. A shelfmark without a library is not
 * emitted either: "Copy: PH441" locates nothing. */
export function copyClause(contributingLibrary?: string | null, shelfmark?: string | null): HoldingCopy | null {
  const raw = (contributingLibrary || '').trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (AGGREGATORS.has(key)) return null;
  const holding_library = CANONICAL[key] || raw;
  const mark = (shelfmark || '').trim() || undefined;
  return {
    holding_library,
    ...(mark ? { shelfmark: mark } : {}),
    statement: `Copy: ${holding_library}${mark ? `, ${mark}` : ''}`,
  };
}

/** Resolve the copy clause straight off a book document. */
export function resolveHoldingCopy(book: {
  image_source?: { contributing_library?: string; shelfmark?: string };
}): HoldingCopy | null {
  return copyClause(book.image_source?.contributing_library, book.image_source?.shelfmark);
}
