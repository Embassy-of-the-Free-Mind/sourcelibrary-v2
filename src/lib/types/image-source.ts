export type ImageSourceProvider =
  | 'efm'  // Embassy of the Free Mind (Bibliotheca Philosophica Hermetica)
  | 'internet_archive'
  | 'google_books'
  | 'hathi_trust'
  | 'biodiversity_heritage_library'
  | 'gallica'
  | 'e_rara'
  | 'mdz'  // Münchener DigitalisierungsZentrum
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
}