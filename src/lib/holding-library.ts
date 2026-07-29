import type { ImageSource, ImageSourceProvider } from '@/lib/types/image-source';

/**
 * Who held the book, and who digitized it — two different institutions.
 *
 * `image_source.provider` names the platform we fetched the scans from. For an
 * aggregator like the Internet Archive that is emphatically NOT the library
 * that owns the physical volume: `Opera Chirurgica` (1628) belongs to Fisher —
 * University of Toronto, and IA merely scanned and hosts it. Crediting only
 * "Internet Archive" drops the custodian that made the book available, which is
 * the credit scholarly convention (and IA's own item page) puts first.
 *
 * The custodian is already stored — `image_source.contributing_library`, set at
 * import from IA's contributor field / IIIF attribution — so this module is
 * about *reading* it correctly, not gathering new data.
 */

/**
 * Providers that host material held and usually digitized by someone else.
 * For every other partner the provider IS the holding institution (the
 * Bodleian's own scans of the Bodleian's own books), so there is no second
 * credit to give and the single-line rendering stays correct.
 *
 * Keyed on `providerKey`, not partner slug — that's what `image_source.provider`
 * carries. A provider absent here is treated as its own custodian.
 */
export const AGGREGATOR_PROVIDERS: ReadonlySet<ImageSourceProvider> = new Set([
  'internet_archive',
  'e-rara',
  'e-codices',
  'europeana',
  'hathi_trust',
  'google_books',
]);

/**
 * Values that name the host, a file format, or nothing at all — never a
 * custodian. These are real values in the corpus (2,315 books say
 * "Internet Archive", 797 say "IIIF Source", 137 "unknown library"), and
 * promoting one to a holding credit would state a falsehood more confidently
 * than the current wording does.
 */
// A trailing parenthetical is allowed because the stored values carry one:
// "Google Books (partner libraries)" names no library at all, and
// "e-codices (Swiss manuscripts)" names the host.
const PLACEHOLDER_HOLDER =
  /^(?:the\s+)?(?:internet\s*archive|archive\.org|iiif(?:\s+source)?|e-?rara|e-?codices|europeana|hathi\s*trust|google\s*books|unknown(?:\s+library)?|unspecified|n\/?a|none|null|undefined|[-—–.\s]*)(?:\s*\([^)]*\))?$/i;

/**
 * Values that are demonstrably not a custodian, harvested by reading all 209
 * distinct names the resolver would otherwise credit. Each pattern describes a
 * recurring shape in upstream metadata, not a one-off string, so new imports
 * with the same defect are caught too.
 */
const NOT_A_LIBRARY: readonly RegExp[] = [
  // Early-modern imprint statements landing in the contributor field:
  // "Sumptibus Autoris", "Basileae : Johannes Froben et Johannes Petri".
  /^(?:sumptibus|apud|ex\s+officina|typis|excudebat|impensis|prostat)\b/i,
  /^[A-ZÀ-Ý][a-zà-ÿ]+(?:ae|iae|is)\s*:\s/,
  // BnF-style agent records with a role suffix — a translator or engraver is a
  // person credited on the work, never the library holding it.
  /\.\s*(?:traducteur|graveur|éditeur(?:\s+scientifique)?|illustrateur|auteur|imprimeur|libraire|former\s+owner)\.?$/i,
  // Text-dump and file-sharing sites, which hold no physical volume at all.
  /^(?:library\s*genesis|libgen|project\s+gutenberg|sacred-texts|mirtitles|public\s+resource|jstor|universal\s+digital\s+library)\b/i,
  /^https?:\/\//i,
];

/** Trim, collapse internal whitespace, drop trailing separators. */
function cleanHolderName(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s,;:.\-–—]+$/, '')
    .trim();
}

/**
 * The custodian named on a record, cleaned, or null when the stored value is a
 * placeholder. Unlike `resolveSourceCredit().holder` this does NOT require the
 * provider to be an aggregator — a self-digitizing library holds its own book,
 * so "Held by Bodleian Library" is true and worth showing in a details panel.
 * Use this for labelled metadata rows; use `resolveSourceCredit` when the
 * question is whether a SECOND institution deserves separate credit.
 */
export function holdingLibraryName(
  source: Pick<ImageSource, 'contributing_library'> | null | undefined,
): string | null {
  const raw = source?.contributing_library;
  if (typeof raw !== 'string') return null;
  const name = cleanHolderName(raw);
  if (!name || PLACEHOLDER_HOLDER.test(name)) return null;
  return NOT_A_LIBRARY.some((re) => re.test(name)) ? null : name;
}

export interface SourceCredit {
  /**
   * The institution holding the physical original, when we know it AND it is
   * distinct from the provider. Null whenever we'd otherwise be guessing.
   */
  holder: string | null;
  /**
   * The platform that digitized and hosts the scans. Falls back to the
   * provider's own name; never borrows `contributing_library`, which is
   * documented as "NOT necessarily the digitizer".
   */
  digitizer: string | null;
}

/**
 * Resolve the two credits for a book's images.
 *
 * `providerName` is the partner's display name (from LIBRARY_PARTNERS) and wins
 * over the record's own `provider_name`, so the credit matches the /libraries
 * page it links to.
 *
 * Fails closed: an unrecognised or placeholder custodian yields
 * `holder: null`, which callers must render as today's single-line credit
 * rather than inventing an attribution.
 */
export function resolveSourceCredit(
  source: Pick<ImageSource, 'provider' | 'provider_name' | 'contributing_library' | 'digitized_by'> | null | undefined,
  providerName?: string,
): SourceCredit {
  const isAggregator = !!source?.provider && AGGREGATOR_PROVIDERS.has(source.provider);
  // Last resort only off an aggregator: there the custodian scanned its own
  // book, so `contributing_library` names the digitizer too. On an aggregator
  // that same fallback is exactly the misattribution this module exists to
  // stop, so it is deliberately unavailable.
  const selfDigitized = isAggregator ? null : source?.contributing_library?.trim() || null;
  const digitizer =
    source?.digitized_by?.trim() || providerName?.trim() || source?.provider_name?.trim() || selfDigitized || null;
  if (!isAggregator) return { holder: null, digitizer };

  const holder = holdingLibraryName(source);
  if (!holder) return { holder: null, digitizer };

  // A custodian that just restates the host or the digitizer is not a second
  // credit — compare on letters only so punctuation/spacing variants collapse.
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key(holder) === key(digitizer || '')) return { holder: null, digitizer };

  return { holder, digitizer };
}
