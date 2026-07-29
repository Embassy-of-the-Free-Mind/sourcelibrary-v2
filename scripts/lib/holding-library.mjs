// Scripts-side twin of src/lib/holding-library.ts — keep the two in lockstep.
// tests/unit/holding-library-credit.test.ts runs a parity check between this
// file and the TS original over every distinct custodian name in the corpus
// fixture; change one side without the other and that test fails.
//
// Why it exists: .mjs maintenance scripts can't import the TS module, and the
// harvest sweep (scripts/maintenance/harvest-holding-libraries.mjs) must decide
// which books still lack a custodian using EXACTLY the rules the site renders
// with — otherwise it re-harvests books that already display a credit, or skips
// books that don't.
//
// Regenerate after editing the TS side: python3 scripts/lib/regen-holding-twin.py


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
export const AGGREGATOR_PROVIDERS = new Set([
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
const NOT_A_LIBRARY = [
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
  // Museum acquisition credit lines — "Rogers Fund, 1925", "Gift of Theodore
  // M. Davis, 1909". These name how an object was ACQUIRED, not who holds it;
  // 119 books carried one as their custodian, all from MET-style imports.
  /^(?:gift|bequest|purchase|anonymous\s+gift|museum\s+accession|.*\bfund\b)\b.*(?:,\s*(?:1[5-9]|20)\d{2}|\bgift\b|\bbequest\b|\bby\s+exchange\b)/i,
  /^(?:rogers|fletcher|harris\s+brisbane\s+dick|lila\s+acheson\s+wallace)\s+fund\b/i,
  // The donor clause can also sit mid-string, after a collection name:
  // "Theodore M. Davis Collection, Bequest of Theodore M. Davis, 1915".
  // Requiring an accompanying year keeps this off real institution names.
  /\b(?:gift|bequest)\s+of\b[^,]*,\s*(?:1[5-9]|20)\d{2}\b/i,
  /^museum\s+accession$/i,
];

/**
 * Hand-verified merges for names that are the SAME institution spelled
 * differently. Every entry below was read against the corpus by hand.
 *
 * Deliberately not automated. Both obvious fuzzy signals are unsafe here:
 * substring containment pairs "British Library" with "University of British
 * Columbia Library", and ASCII-folding collapses every CJK name to the empty
 * string, which would merge 北京大學圖書館 (Peking University) with
 * 浙江大学图书馆 (Zhejiang University). Only 6 genuine variant clusters exist
 * at meaningful volume, so a map costs less than a heuristic that can silently
 * merge two real libraries.
 *
 * Branch libraries are NOT merged into their parent: "Robarts - University of
 * Toronto" stays distinct from "Fisher - University of Toronto" because that
 * precision is exactly the credit this feature exists to give.
 *
 * Keyed by lowercased name.
 */
const HOLDING_LIBRARY_ALIASES = new Map(
  Object.entries({
    // Same library, four spellings (3,042 books). The native name wins because
    // it is what the overwhelming majority of records already use.
    'bayerische staatsbibliothek': 'Bayerische Staatsbibliothek (Munich)',
    'bayerische staatsbibliothek, munich': 'Bayerische Staatsbibliothek (Munich)',
    // English exonyms. These share NO tokens with their native form, so no
    // string-similarity heuristic can find them — they surfaced only by reading
    // a random sample of kept names, which is why that review is part of the
    // process rather than a one-off.
    'bavarian state library': 'Bayerische Staatsbibliothek (Munich)',
    'national central library of florence': 'Biblioteca Nazionale Centrale di Firenze',
    'heidelberg university library': 'Universitätsbibliothek Heidelberg',
    // Leading article.
    'the library of congress': 'Library of Congress',
    'the british library': 'British Library',
    // "via" routes name a intermediary, not a different holder.
    'british library (via google arts & culture)': 'British Library',
    'british library (via adam mclean / alchemywebsite.com)': 'British Library',
    'british library (via google arts & culture and alchemywebsite.com)': 'British Library',
    // Missing space / place qualifier.
    'stiftung der werke von c.g.jung': 'Stiftung der Werke von C.G. Jung (Zürich)',
    'sterling and francine clark art institute. library': 'Sterling and Francine Clark Art Institute Library',
    'eth-bibliothek zürich (e-rara)': 'ETH-Bibliothek Zürich',
    'biblioteka jagiellońska (depozyt)': 'Biblioteka Jagiellońska',
    'lyon public library (bibliothèque jésuite des fontaines)': 'Lyon Public Library',
    // Institutional renames.
    'wellcome library': 'Wellcome Collection',
    'the wellcome library, london': 'Wellcome Collection',
    'smithsonian libraries': 'Smithsonian Libraries and Archives',
    // Parent institution vs its library service.
    'university of california': 'University of California Libraries',
    'boston college': 'Boston College Libraries',
    'columbia university': 'Columbia University Libraries',
    'koninklijke bibliotheek': 'Koninklijke Bibliotheek, Nationale bibliotheek van Nederland',
    'national library of the netherlands': 'Koninklijke Bibliotheek, Nationale bibliotheek van Nederland',
    // One U of T branch under three names (28 books).
    'john m kelly library rare books - university of toronto': 'Kelly - University of Toronto',
    'university of toronto - kelly library': 'Kelly - University of Toronto',
    'university of toronto, faculty of music library': 'Music - University of Toronto',
    'wikisource / wikimedia commons': 'Wikimedia Commons',
    'wikimedia commons (wikisource loves manuscripts / community digitisation)': 'Wikimedia Commons',
  }),
);

/**
 * The name to GROUP and display a custodian under — `holdingLibraryName` plus
 * the alias merge above. Use this anywhere names are counted or listed (the
 * /libraries directory, a per-provider breakdown); the un-canonicalized name is
 * fine for a single record's own credit line.
 */
export function canonicalHoldingLibrary(source) {
  const name =
    typeof source === 'string' ? holdingLibraryName({ contributing_library: source }) : holdingLibraryName(source);
  if (!name) return null;
  return HOLDING_LIBRARY_ALIASES.get(name.toLowerCase()) ?? name;
}

/** Trim, collapse internal whitespace, drop trailing separators. */
function cleanHolderName(raw) {
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
export function holdingLibraryName(source) {
  const raw = source?.contributing_library;
  if (typeof raw !== 'string') return null;
  const name = cleanHolderName(raw);
  if (!name || PLACEHOLDER_HOLDER.test(name)) return null;
  return NOT_A_LIBRARY.some((re) => re.test(name)) ? null : name;
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
export function resolveSourceCredit(source, providerName) {
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
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key(holder) === key(digitizer || '')) return { holder: null, digitizer };

  return { holder, digitizer };
}
