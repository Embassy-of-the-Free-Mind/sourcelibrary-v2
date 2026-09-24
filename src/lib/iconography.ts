/**
 * Iconographic classification using Iconclass and CIT (Chinese Iconography Thesaurus).
 *
 * Iconclass: hierarchical alphanumeric system for Western art subjects (iconclass.org)
 * CIT: parallel system for Chinese visual culture (chineseiconography.org)
 *
 * CIT codes are assigned by Gemini during image extraction. Iconclass codes no longer
 * are (#4856): recalled from memory they were largely invalid or wrong. The Iconclass
 * API helpers below (search, lookup, validate) are what a future constrained tagging
 * pass should use.
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

// --- Prompt context for Gemini classification ---

/**
 * CIT (Chinese Iconography Thesaurus) top-level structure.
 * Used when classifying images from Chinese/East Asian visual culture.
 */
export const CIT_CONTEXT = `
CIT CLASSIFICATION — assign 2-5 codes from the Chinese Iconography Thesaurus (chineseiconography.org).
CIT uses hierarchical numeric codes with dots. Be as specific as possible.

Top-level divisions:
1 - Nature (自然界): landscape, weather, celestial bodies, flora, fauna
  1.1 - nature (general): the five phases, qi
  1.2 - light and weather
  1.3 - water and landforms
  1.4 - rocks and minerals
  1.5 - plants
  1.6 - animals
  1.7 - fantastic creatures
  1.8 - composite creatures
2 - Human Being (人類): anatomy, activities, emotions
  2.1 - human body
  2.2 - human life and activities
  2.3 - posture and gesture
  2.4 - dress and adornment
  2.5 - food and drink
  2.6 - medicine and hygiene
  2.7 - death and burial
  2.8 - recreation and sport
  2.9 - arts
  2.10 - music
  2.11 - the human mind
3 - Society and Culture (社會與文化): government, military, agriculture, trade
  3.1 - government and administration
  3.2 - law and justice
  3.3 - military
  3.4 - agriculture and fishing
  3.5 - crafts and industry
  3.6 - commerce and transport
  3.7 - architecture and city planning
  3.8 - furnishings and objects
  3.9 - writing, books, education
4 - Religion (宗教): Buddhism, Daoism, Confucianism, folk religion
  4.1 - religion (general)
  4.2 - Buddhism
  4.3 - Daoism
  4.4 - Confucianism
  4.5 - folk religion
  4.6 - Islam
  4.7 - other religions
5 - Myths and Legends (神話與傳說): creation myths, immortals, legendary figures
6 - History and Geography (歷史與地理)
7 - Literary Works (文學作品): poetry, drama, novels

Return codes as strings: ["4.3", "1.7.2", "5.3"]`.trim();

/**
 * Determine which classification system(s) to use based on book context.
 * Only East Asian content gets CIT codes.
 *
 * Iconclass is deliberately NOT requested here (#4856). Asked to recall codes from
 * memory, the model invented ~29% of them and mislabelled many real ones (a blind
 * A/B on 39 images: 1 good of 39 recalled vs 22 good when picking from real
 * candidates found via `iconclassSearch`). If Iconclass comes back, it comes back as
 * a separate pass that chooses from `iconclassSearch` results and runs
 * `validateIconclassCodes`, never as free recall in the extraction prompt.
 */
export function getClassificationSystems(bookContext?: {
  language?: string;
  subjects?: string[];
  cultural_sphere?: string;
}): 'cit'[] {
  if (!bookContext) return [];

  const lang = (bookContext.language || '').toLowerCase();
  const subjects = (bookContext.subjects || []).map(s => s.toLowerCase());
  const sphere = (bookContext.cultural_sphere || '').toLowerCase();

  const isEastAsian =
    ['chinese', 'zh', 'ja', 'ko', 'japanese', 'korean'].some(l => lang.includes(l)) ||
    sphere.includes('chinese') || sphere.includes('east asian') ||
    subjects.some(s => ['chinese', 'daoist', 'buddhist', 'confucian', 'zen'].includes(s));

  return isEastAsian ? ['cit'] : [];
}

/**
 * Build the iconographic classification section for the image extraction prompt.
 */
export function buildClassificationPrompt(systems: 'cit'[]): string {
  if (!systems.includes('cit')) return '';
  return `\nICONOGRAPHIC CLASSIFICATION — In addition to the metadata fields above, classify each image using standardized iconographic codes.\n\n${CIT_CONTEXT}\n\nAdd to each image object:\n  "cit": ["4.3", "1.7.2"]\n`;
}
