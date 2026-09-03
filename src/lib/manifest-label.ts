/**
 * A IIIF manifest `label` is not reliably a title.
 *
 * Gallica sets it to the holding statement — "BnF, département Réserve des
 * livres rares, J-3263 (BIS,1)" — while the actual title ("De Bosphoro Thracio
 * libri III") lives in the OAI/dc record and in the manifest's own `Title`
 * metadata pair. Importers that took `label` as a display title therefore named
 * 977 books after a shelf, 216 of them live and publicly readable (#4572).
 *
 * `display_title` is what the reader, the library grid and the card render
 * (`display_title ?? title`), so a wrong value here is not cosmetic — it is the
 * name of the book everywhere a reader meets it.
 *
 * The check lives in its own module because two importers construct book docs
 * from a manifest (`src/lib/import-utils.ts` and `src/app/api/import/iiif/
 * route.ts`) and a guard applied to only one of them is how the same defect
 * ships twice.
 */

/** Repository names that prefix a holding statement rather than name a work. */
const REPOSITORY_PREFIXES = [
  'bnf',
  'bibliotheque nationale de france',
  'bibliotheca',
  'bayerische staatsbibliothek',
  'staatsbibliothek zu berlin',
  'osterreichische nationalbibliothek',
  'koninklijke bibliotheek',
  'british library',
  'bodleian library',
  'biblioteca nazionale',
  'biblioteca apostolica vaticana',
  'library of congress',
  'universitatsbibliothek',
  'universiteitsbibliotheek',
];

/**
 * Department words that only appear in a shelf location. Deliberately narrow:
 * "département" alone is enough on a Gallica label, but a real title could
 * plausibly contain "collection" or "library", so those are not listed.
 */
const SHELF_MARKERS = [
  'departement philosophie',
  'departement litterature',
  'departement droit',
  'departement sciences',
  'departement reserve',
  'departement des manuscrits',
  'departement de la musique',
  'reserve des livres rares',
];

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Drop a leading repository name so "BnF, département X" compares to "…département X". */
function stripRepositoryPrefix(folded: string): string {
  for (const p of REPOSITORY_PREFIXES) {
    if (folded.startsWith(p + ' ')) return folded.slice(p.length + 1).trim();
  }
  return folded;
}

/**
 * True when `label` reads as a holding statement (shelfmark / call number)
 * rather than the name of a work.
 *
 * `callNumber` is the manifest's own `Call Number` / `Shelfmark` metadata value
 * when it has one. That is the strongest signal available: Gallica publishes
 * both, and the label is the call number with the repository name abbreviated,
 * so after folding and stripping the prefix one contains the other.
 */
export function isHoldingStatement(
  label: string | null | undefined,
  callNumber?: string | null,
): boolean {
  if (!label) return false;
  const l = stripRepositoryPrefix(fold(label));
  if (!l) return false;

  // Strongest signal: the manifest itself says this string is the shelfmark.
  if (callNumber) {
    const c = stripRepositoryPrefix(fold(callNumber));
    if (c && (c === l || c.includes(l) || l.includes(c))) return true;
  }

  // Failing that, a department name only ever appears in a shelf location.
  if (SHELF_MARKERS.some(m => l.includes(m))) return true;

  // A bare repository name with nothing else ("BnF") is not a title either.
  const raw = fold(label);
  if (REPOSITORY_PREFIXES.includes(raw)) return true;

  return false;
}

/**
 * The manifest label if it is usable as a display title, otherwise null.
 *
 * Callers should keep their existing precedence — an explicit caller-supplied
 * `display_title` still wins; this only filters the manifest fallback.
 */
export function usableManifestLabel(
  label: string | null | undefined,
  callNumber?: string | null,
): string | null {
  if (!label) return null;
  return isHoldingStatement(label, callNumber) ? null : label;
}
