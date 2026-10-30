export type ImageSourceProvider =
  | 'bph'            // Bibliotheca Philosophica Hermetica (Embassy of the Free Mind)
  | 'internet_archive'
  | 'google_books'
  | 'hathi_trust'
  | 'biodiversity_heritage_library'
  | 'gallica'
  | 'e_rara'         // Legacy — prefer 'e-rara'
  | 'e-rara'         // e-rara (Swiss rare books)
  | 'mdz'            // Münchener DigitalisierungsZentrum (Bavarian State Library)
  | 'bodleian'       // Bodleian Library, University of Oxford
  | 'cambridge'      // Cambridge Digital Library (CUDL)
  | 'hab'            // Herzog August Bibliothek Wolfenbüttel
  | 'vatican'        // Biblioteca Apostolica Vaticana (DigiVatLib)
  | 'vatlib'         // Vatican Library (alternative endpoint)
  | 'europeana'      // Europeana aggregator
  | 'bl'             // British Library
  | 'imslp'          // IMSLP / Petrucci Music Library (public-domain scores; re-host)
  | 'sbb'            // Staatsbibliothek zu Berlin
  | 'onb'            // Austrian National Library (Österreichische Nationalbibliothek)
  | 'loc'            // Library of Congress
  | 'yale_beinecke'  // Yale Beinecke Rare Book & Manuscript Library
  | 'harvard'        // Harvard University Library (Houghton)
  | 'penn_colenda'   // University of Pennsylvania (Schoenberg Collection)
  | 'huntington'     // The Huntington Library
  | 'getty'          // Getty Research Institute
  | 'kyoto_rmda'     // Kyoto University Rare Materials Digital Archive
  | 'cmc_kloss'      // CMC Prins Frederik — Bibliotheca Klossiana
  | 'etcsl'          // Electronic Text Corpus of Sumerian Literature
  | 'cdli'           // Cuneiform Digital Library Initiative
  | 'heidelberg'     // Heidelberg University Library
  | 'iiif'           // Generic IIIF source (should be migrated to specific provider)
  | 'wellcome'       // Wellcome Collection
  | 'manchester'     // John Rylands Library, University of Manchester
  | 'allard_pierson' // Allard Pierson, University of Amsterdam
  | 'laurenziana'    // Biblioteca Medicea Laurenziana, Florence
  | 'leiden'         // Leiden University Library
  | 'chester_beatty' // Chester Beatty Library, Dublin
  | 'ndl_japan'      // National Diet Library of Japan
  | 'e-codices'      // Virtual Manuscript Library of Switzerland
  | 'v_and_a'        // Victoria and Albert Museum
  | 'tu_delft'       // TU Delft Library
  | 'qdl'            // Qatar Digital Library / British Library
  | 'escorial'       // Real Biblioteca del Monasterio de El Escorial
  | 'bnp'            // Biblioteca Nacional de Portugal
  | 'claremont'      // Claremont Colleges Library, Special Collections (Nag Hammadi Archive, CONTENTdm)
  | 'marciana'       // Biblioteca Nazionale Marciana, Venice
  | 'irht'           // IRHT (CNRS)
  | 'bdrc'           // Buddhist Digital Resource Center
  | 'ndl'            // National Diet Library of Japan (alternate key)
  | 'met'            // Metropolitan Museum of Art
  | 'oraec'          // Open Richly Annotated Egyptian Corpus (oraec.github.io)
  | 'bsb'            // Bayerische Staatsbibliothek (alternate key for mdz)
  | 'eap'            // British Library Endangered Archives Programme
  | 'sat_daizokyo'   // SAT Daizokyo Buddhist Text Database
  | 'tu_darmstadt'   // Technische Universität Darmstadt (ULB)
  | 'byu'            // Brigham Young University, L. Tom Perry Special Collections
  | 'princeton'      // Princeton University Library (DPUL / Figgy IIIF)
  | 'contentdm'      // OCLC CONTENTdm
  | 'goettingen'     // Göttingen State and University Library (SUB / GDZ)
  | 'slub_dresden'   // SLUB Dresden (Saxon State and University Library)
  | 'b-nice'         // B-NICE / Pustaka Nusantara (Indonesian MSS via Leiden & KB)
  | 'wikimedia_commons' // Wikimedia Commons (Wikisource Loves Manuscripts etc.)
  | 'tartu_dspace'   // University of Tartu Library (DSpace)
  | 'morgan'         // Morgan Library & Museum, New York
  | 'ia'             // Internet Archive (alternate key)
  | 'museumsofindia' // Museums of India (museumsofindia.gov.in)
  | 'library'
  | 'user_upload'
  | 'other';

// Common image licenses
export const IMAGE_LICENSES = [
  { id: 'publicdomain', name: 'Public Domain', description: 'No known copyright restrictions' },
  { id: 'CC0-1.0', name: 'CC0 1.0', description: 'Public Domain Dedication' },
  { id: 'CC-BY-4.0', name: 'CC BY 4.0', description: 'Attribution required' },
  { id: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0', description: 'Attribution, ShareAlike' },
  { id: 'CC-BY-NC-4.0', name: 'CC BY-NC 4.0', description: 'Attribution, NonCommercial' },
  { id: 'in-copyright', name: 'In Copyright', description: 'Permission obtained from rights holder' },
  { id: 'unknown', name: 'Unknown', description: 'License status not determined' },
] as const;

/**
 * What a stored `image_source.license` should be SHOWN as.
 *
 * `IMAGE_LICENSES` is our seven-id vocabulary, and `BibliographicInfo` used to
 * resolve a stored value by exact id and otherwise print it raw. Measured across
 * 22,081 live books (`scripts/audit/record-completeness.mjs`), 3,740 of them
 * store something else — and almost none of it is wrong. Sources record their
 * own rights statement, and that is what the importers faithfully kept: a
 * rightsstatements.org URI from MDZ, a Creative Commons deed URL from the
 * Internet Archive, "PDM 1.0" from e-rara, "Open access (University of Oxford)"
 * from ETCSL. The defect was ours: a reader saw a bare URL where a licence
 * should be.
 *
 * **Resolved for display, never rewritten in the data.** The stored string is
 * the source's own claim and is provenance; normalising it away would lose what
 * the institution actually said. And it would be worse than lossy in one case:
 * `rightsstatements.org/vocab/NoC-NC` means "No Copyright – Non-Commercial Use
 * Only", which is NOT public domain. Rewriting those 1,260 records to
 * `publicdomain` would have misstated the rights on every one of them.
 *
 * An unrecognised value still falls through to itself. That is the honest
 * default: show what the source said rather than guess a licence for it.
 */
const LICENSE_ALIASES: Record<string, string> = {
  // Public Domain Mark, in the spellings the importers actually stored.
  'http://creativecommons.org/publicdomain/mark/1.0/': 'Public Domain Mark 1.0',
  'https://creativecommons.org/publicdomain/mark/1.0/': 'Public Domain Mark 1.0',
  'http://creativecommons.org/licenses/publicdomain/': 'Public Domain Mark 1.0',
  'creative commons public domain mark 1.0': 'Public Domain Mark 1.0',
  'pdm 1.0': 'Public Domain Mark 1.0',
  pdm: 'Public Domain Mark 1.0',
  'public-domain': 'Public Domain',
  public_domain: 'Public Domain',
  'public domain': 'Public Domain',
  // CC0 dedication.
  'http://creativecommons.org/publicdomain/zero/1.0/': 'CC0 1.0',
  'https://creativecommons.org/publicdomain/zero/1.0/': 'CC0 1.0',
  cc0: 'CC0 1.0',
  'cc0 1.0 universal': 'CC0 1.0',
  // Deed URLs for the licence family.
  'https://creativecommons.org/licenses/by-nd/4.0/': 'CC BY-ND 4.0',
  'http://creativecommons.org/licenses/by-nc/4.0/': 'CC BY-NC 4.0',
  'http://creativecommons.org/licenses/by-nc-nd/3.0/': 'CC BY-NC-ND 3.0',
  'http://creativecommons.org/licenses/by-nc-nd/4.0/': 'CC BY-NC-ND 4.0',
  'https://creativecommons.org/licenses/by-nc-nd/4.0/': 'CC BY-NC-ND 4.0',
  'https://creativecommons.org/licenses/by-nc-sa/4.0/': 'CC BY-NC-SA 4.0',
  'http://creativecommons.org/licenses/by-nc-sa/2.5/scotland/': 'CC BY-NC-SA 2.5 Scotland',
  // NOT public domain — see the note above. These say a work is out of
  // copyright in the holder's judgement but reserved for non-commercial use.
  'https://rightsstatements.org/vocab/noc-nc/1.0/': 'No Copyright – Non-Commercial Use Only',
  'http://rightsstatements.org/vocab/noc-nc/1.0/': 'No Copyright – Non-Commercial Use Only',
  'https://rightsstatements.org/vocab/inc/1.0/': 'In Copyright',
  'https://rightsstatements.org/vocab/und/1.0/': 'Copyright Undetermined',
  // Princeton's manuscripts (#6559): the holder believes the item is free of
  // copyright but could not make a conclusive determination.
  'http://rightsstatements.org/vocab/nkc/1.0/': 'No Known Copyright',
  'https://rightsstatements.org/vocab/nkc/1.0/': 'No Known Copyright',
};

/** Display name for a stored licence value, and whether the value is itself a link. */
export function licenseDisplay(value?: string | null): { name: string; url?: string } | null {
  if (!value || !String(value).trim()) return null;
  const raw = String(value).trim();
  const byId = IMAGE_LICENSES.find((l) => l.id === raw);
  if (byId) return { name: byId.name };
  const alias = LICENSE_ALIASES[raw.toLowerCase()];
  const url = /^https?:\/\//i.test(raw) ? raw : undefined;
  if (alias) return { name: alias, url };
  // Unrecognised: show the source's own words. A bare URL gets a shorter label
  // than the URL itself, because a link is not a licence name.
  return { name: url ? 'See the source’s rights statement' : raw, url };
}

/**
 * What the holding library itself stated about its page images, read from its manifest or record
 * (scripts/maintenance/backfill-rights-provenance.mjs, scripts/lib/rights-normalize.mjs). Only the
 * fields the reader page uses are typed here.
 */
export interface LibraryRightsStatement {
  class?: string;                 // public-domain | noc-nc | cc-by-nc | terms-of-use | in-copyright | unknown | …
  status?: string;                // stated | stated-from-import | assumed-by-importer | manifest-silent | …
  statement_uri?: string | null;  // rightsstatements.org / Creative Commons URI the library gave
  attribution_required?: string | null;
  terms_text?: string | null;     // the library's own sentence, when it is terms rather than a licence
}

const RIGHTS_CLASS_NAMES: Record<string, string> = {
  'public-domain': 'Public Domain',
  'noc-nc': 'No Copyright – Non-Commercial Use Only',
  'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA', 'cc-by-nd': 'CC BY-ND',
  'cc-by-nc': 'CC BY-NC', 'cc-by-nc-sa': 'CC BY-NC-SA', 'cc-by-nc-nd': 'CC BY-NC-ND',
  'in-copyright': 'In Copyright',
  'terms-of-use': 'The library’s terms of use',
};

const STANDARD_RIGHTS_URI = /^https?:\/\/(creativecommons\.org|rightsstatements\.org)\//i;
const CLASS_RIGHTS_URIS: Record<string, string> = {
  'noc-nc': 'http://rightsstatements.org/vocab/NoC-NC/1.0/',
  'in-copyright': 'http://rightsstatements.org/vocab/InC/1.0/',
  'public-domain': 'http://creativecommons.org/publicdomain/mark/1.0/',
};

/**
 * The rights URI the holding library stated, for machine-readable surfaces (IIIF `rights`,
 * schema.org `license`) that take one Creative Commons or rightsstatements.org URI (#7771).
 *  - `undefined`: the library has not spoken (no statement, or an importer assumption). The
 *    caller keeps its old path, the stored licence.
 *  - a URI: the library's own, or the standard one for its class.
 *  - `null`: the library spoke but gave no standard URI (its own terms of use). The caller must
 *    NOT fall back to a public-domain default, which would contradict the library.
 */
export function libraryRightsUri(src?: { rights_normalized?: LibraryRightsStatement | null } | null): string | null | undefined {
  const rn = src?.rights_normalized;
  const stated = !!rn && (rn.status === 'stated' || rn.status === 'stated-from-import') && !!rn.class && rn.class !== 'unknown';
  if (!stated) return undefined;
  if (rn.statement_uri && STANDARD_RIGHTS_URI.test(rn.statement_uri)) return rn.statement_uri;
  return CLASS_RIGHTS_URIS[rn.class!] ?? null;
}

/**
 * The licence, credit and terms a book page shows for its images (#7771). The holding library's
 * own statement wins when we have read one (status `stated`, or `stated-from-import`, which is the
 * library's field captured at import). Otherwise the importer's stored values are shown, as before:
 * for 32% of books that value is an importer default (`publicdomain`), not a library statement.
 */
export function displayedImageRights(src?: { license?: string | null; attribution?: string | null; rights_normalized?: LibraryRightsStatement | null } | null): {
  license: { name: string; url?: string } | null;
  credit: string | null;
  terms: string | null;
  fromLibrary: boolean;
} {
  const rn = src?.rights_normalized;
  const stated = !!rn && (rn.status === 'stated' || rn.status === 'stated-from-import') && !!rn.class && rn.class !== 'unknown';
  if (!stated) {
    return { license: licenseDisplay(src?.license), credit: src?.attribution || null, terms: null, fromLibrary: false };
  }
  const byUri = rn.statement_uri ? licenseDisplay(rn.statement_uri) : null;
  // A URI we have no name for gets the class name, still linked to the library's statement.
  const license = byUri && byUri.name !== 'See the source’s rights statement'
    ? byUri
    : { name: RIGHTS_CLASS_NAMES[rn.class!] ?? 'See the source’s rights statement', url: rn.statement_uri || undefined };
  return {
    license,
    credit: rn.attribution_required || src?.attribution || null,
    terms: rn.class === 'terms-of-use' ? rn.terms_text || null : null,
    fromLibrary: true,
  };
}

// Image source and licensing info
export interface ImageSource {
  provider: ImageSourceProvider;
  provider_name?: string;       // Human-readable: "Internet Archive", "Bayerische Staatsbibliothek"
  source_url?: string;          // Link to original (e.g., archive.org/details/...)
  identifier?: string;          // IA identifier, Google Books ID, etc.
  license: string;              // SPDX or custom: "publicdomain", "CC-BY-4.0", "in-copyright"
  license_url?: string;         // Link to license terms
  attribution?: string;         // Required credit text (if any)
  access_date?: Date;           // When images were retrieved
  notes?: string;               // Additional context (e.g., "Scans provided by X library")
  iiif_manifest?: string;       // IIIF Presentation API manifest URL
  shelfmark?: string;           // Physical shelfmark/classmark (e.g., "Pal.lat.1885", "MS. Arab. c. 90")
  contributing_library?: string; // Institution that holds/provided the item (e.g., IA contributor field) — NOT necessarily the digitizer
  digitized_by?: string;        // Who actually digitized the scans (e.g., "Allard Pierson (University of Amsterdam)")
  digital_host?: string;        // Host serving the digital images (e.g., "uvaerfgoed.nl")
  sponsor?: string;             // Funding entity for digitization (e.g., "Google", "Sloan Foundation")
  rights_normalized?: LibraryRightsStatement | null; // what the holding library stated (see displayedImageRights)
}