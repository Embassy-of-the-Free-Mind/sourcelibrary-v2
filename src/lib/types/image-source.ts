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
  | 'marciana'       // Biblioteca Nazionale Marciana, Venice
  | 'irht'           // IRHT (CNRS)
  | 'bdrc'           // Buddhist Digital Resource Center
  | 'ndl'            // National Diet Library of Japan (alternate key)
  | 'met'            // Metropolitan Museum of Art
  | 'oraec'          // Online Resource for Ancient Egyptian Coffin Texts
  | 'bsb'            // Bayerische Staatsbibliothek (alternate key for mdz)
  | 'eap'            // British Library Endangered Archives Programme
  | 'sat_daizokyo'   // SAT Daizokyo Buddhist Text Database
  | 'tu_darmstadt'   // Technische Universität Darmstadt (ULB)
  | 'byu'            // Brigham Young University, L. Tom Perry Special Collections
  | 'contentdm'      // OCLC CONTENTdm
  | 'ia'             // Internet Archive (alternate key)
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
}