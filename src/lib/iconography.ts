/**
 * Iconclass API helpers (iconclass.org): lookup, keyword search, validation.
 *
 * No iconographic codes are assigned during image extraction any more (#4856).
 * Recalled from memory, Iconclass codes were largely invalid or wrong. The CIT
 * (Chinese Iconography Thesaurus) request was asked for at the top level of each
 * image object while the parser read `metadata.cit`, so not one CIT code was ever
 * saved. A future tagging pass should choose from `iconclassSearch` candidates and
 * run `validateIconclassCodes`, never ask the model to recall codes.
 */

const ICONCLASS_API = 'https://iconclass.org';

// --- Iconclass API (for validation and enrichment, not classification) ---

export interface IconclassEntry {
  n: string;              // notation code
  txt: Record<string, string>;  // multilingual descriptions
  kw: Record<string, string[]>; // keywords per language
  p: string[];            // path (ancestors)
  c: string[];            // children
  r: string[];            // related
}

/** Look up an Iconclass notation. Returns null if invalid. */
export async function iconclassLookup(notation: string): Promise<IconclassEntry | null> {
  try {
    const res = await fetch(`${ICONCLASS_API}/${encodeURIComponent(notation)}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Search Iconclass by keyword. Returns notation IDs. */
export async function iconclassSearch(query: string, limit = 10): Promise<string[]> {
  try {
    const res = await fetch(
      `${ICONCLASS_API}/api/search?q=${encodeURIComponent(query)}&lang=en&size=${limit}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data?.result || [];
  } catch {
    return [];
  }
}

/** Validate an array of Iconclass codes. Returns only the valid ones. */
export async function validateIconclassCodes(codes: string[]): Promise<string[]> {
  const results = await Promise.all(
    codes.map(async (code) => {
      const entry = await iconclassLookup(code);
      return entry ? code : null;
    })
  );
  return results.filter((c): c is string => c !== null);
}
