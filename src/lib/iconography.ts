/**
 * Iconographic classification using Iconclass and CIT (Chinese Iconography Thesaurus).
 *
 * Iconclass: hierarchical alphanumeric system for Western art subjects (iconclass.org)
 * CIT: parallel system for Chinese visual culture (chineseiconography.org)
 *
 * Both are assigned by Gemini during image extraction — no external API calls needed.
 * Codes can be validated post-hoc via the Iconclass REST API.
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
 * Iconclass top-level divisions + key branches for Source Library content.
 * Used as prompt context so Gemini assigns valid codes.
 */
export const ICONCLASS_CONTEXT = `
ICONCLASS CLASSIFICATION — assign 2-5 codes from the Iconclass system (iconclass.org).
Iconclass uses hierarchical alphanumeric codes. Be as specific as possible.

Top-level divisions:
0 - Abstract, Non-representational Art
1 - Religion and Magic
2 - Nature
3 - Human Being, Man in General
4 - Society, Civilization, Culture
5 - Abstract Ideas and Concepts
6 - History
7 - Bible
8 - Literature
9 - Classical Mythology and Ancient History

Key sub-branches for early modern / esoteric content:
11H - saints
12 - non-Christian religions
14 - astrology, prophecy
21 - four elements (earth, water, air, fire)
22 - natural phenomena
25F - animals (25F23 predatory, 25F3 birds, 25FF fabulous animals)
25G - plants and trees
31A - human figure, proportions
41 - domestic life, housing
42 - family
44 - state, government
46A1 - social classes
48A98 - writing, calligraphy
48C - art theory, emblems, allegories
49 - handicrafts, technology
49C - chemistry
49E39 - alchemy (equipment, substances, processes, philosopher's stone)
49E393 - alchemistic equipment
52 - knowledge, learning
53 - astrology in practice
61B2 - personifications
71-73 - Bible (Old Testament, New Testament, apocrypha)
83 - Greek/Roman literature
92 - gods and goddesses of classical antiquity
94 - tales from Roman history
95 - tales from Greek history
96 - tales from Roman history (specific)
97 - metamorphoses (Ovid)
98 - classical history and historical persons

Parenthetical qualifiers add specificity: 25F23(LION) = predatory animals: lion
Structural keys with + prefix: 25F(+12) = group of animals

Return codes as strings in an array, most specific first.
Example: ["49E39", "25FF41", "48C901"]`.trim();

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
 * Most Source Library books get Iconclass. Chinese/East Asian content gets CIT.
 * Some books may get both (e.g., Jesuit texts bridging both traditions).
 */
export function getClassificationSystems(bookContext?: {
  language?: string;
  subjects?: string[];
  cultural_sphere?: string;
}): ('iconclass' | 'cit')[] {
  if (!bookContext) return ['iconclass'];

  const lang = (bookContext.language || '').toLowerCase();
  const subjects = (bookContext.subjects || []).map(s => s.toLowerCase());
  const sphere = (bookContext.cultural_sphere || '').toLowerCase();

  const isEastAsian =
    ['chinese', 'zh', 'ja', 'ko', 'japanese', 'korean'].some(l => lang.includes(l)) ||
    sphere.includes('chinese') || sphere.includes('east asian') ||
    subjects.some(s => ['chinese', 'daoist', 'buddhist', 'confucian', 'zen'].includes(s));

  const isWestern =
    ['latin', 'la', 'de', 'en', 'fr', 'it', 'nl', 'es', 'greek', 'hebrew'].some(l => lang.includes(l)) ||
    !isEastAsian; // default to Western

  const systems: ('iconclass' | 'cit')[] = [];
  if (isWestern) systems.push('iconclass');
  if (isEastAsian) systems.push('cit');

  return systems.length > 0 ? systems : ['iconclass'];
}

/**
 * Build the iconographic classification section for the image extraction prompt.
 */
export function buildClassificationPrompt(systems: ('iconclass' | 'cit')[]): string {
  const parts: string[] = [];

  if (systems.includes('iconclass')) {
    parts.push(ICONCLASS_CONTEXT);
  }
  if (systems.includes('cit')) {
    parts.push(CIT_CONTEXT);
  }

  if (parts.length === 0) return '';

  return `\nICONOGRAPHIC CLASSIFICATION — In addition to the metadata fields above, classify each image using standardized iconographic codes.\n\n${parts.join('\n\n')}\n\nAdd to each image object:\n  "iconclass": ["49E39", "25FF41"]${systems.includes('cit') ? ',\n  "cit": ["4.3", "1.7.2"]' : ''}\n`;
}
