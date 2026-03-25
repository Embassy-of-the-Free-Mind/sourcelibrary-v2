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
  | 'iiif'           // Generic IIIF source
  | 'wellcome'       // Wellcome Collection
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
  contributing_library?: string; // Physical library that provided/digitized the item (e.g., IA contributor field)
  sponsor?: string;             // Funding entity for digitization (e.g., "Google", "Sloan Foundation")
}