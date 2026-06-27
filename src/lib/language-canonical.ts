// TypeScript twin of scripts/lib/language-count.mjs — keep the two in sync.
//
// The `books.language` field is free-text and messy: it mixes compound labels
// ("Hebrew and Judeo-Arabic", "Greek/Latin", "Latin-German"), script/stage
// variants ("Geez"/"Ge'ez", "Ancient Greek", "Ottoman Turkish"), and junk
// tokens ("auto-detect", "Multiple", "e"). A naive distinct() over-counts and
// surfaces non-languages in the catalog language filter.
//
// Two uses here:
//  - isSingleRealLanguage(label): gate for the catalog language dropdown —
//    keeps a label only when it resolves to exactly ONE real language, so the
//    raw value still works with the exact `eq('language', value)` filter while
//    junk ("e") and multi-language "collab" labels ("Greek/Latin") drop out.
//  - countDistinctLanguages(labels): the honest distinct-language count for
//    corpus stats (splits compounds, folds variants, drops junk).

// Tokens that are not languages at all.
const JUNK = new Set<string>([
  'auto-detect', 'auto', 'detect', 'multiple', 'mul', 'lit', 'undetermined',
  'unknown', 'various', 'various caucasian', 'n/a', 'zxx', 'roa', '',
]);

// Variant / stage / script labels folded into one canonical language.
const VARIANTS: Record<string, string> = {
  "ge'ez": 'geez', 'ethiopic': 'geez',
  'egyptian hieroglyphs': 'egyptian', 'demotic': 'egyptian',
  'maya hieroglyphs': 'maya', 'yucatec maya': 'maya', "k'iche' maya": 'maya', "k'iche'": 'maya', 'cakchiquel': 'maya',
  'classical armenian': 'armenian',
  'samaritan hebrew': 'hebrew',
  'classical chinese': 'chinese', 'literary chinese': 'chinese',
  'middle english': 'english', 'old english': 'english',
  'middle french': 'french', 'old french': 'french', 'anglo-norman': 'french',
  'middle high german': 'german', 'low german': 'german',
  'old javanese': 'javanese',
  'ancient greek': 'greek',
  'old spanish': 'spanish',
  'scottish gaelic': 'gaelic',
  'old irish': 'irish',
  'ottoman turkish': 'turkish', 'chagatai turkish': 'turkish',
  'church slavonic': 'slavonic',
};

// Hyphenated names that are a SINGLE language — never split these on the hyphen.
const KEEP_HYPHEN = new Set<string>([
  'judeo-arabic', 'judeo-greek', 'judeo-italian', 'judeo-occitan', 'judeo-persian',
  'anglo-norman', 'anglo-saxon',
]);

function normalizeAtom(raw: string): string {
  let x = String(raw).trim().toLowerCase();
  x = x.replace(/\(.*?\)/g, '');                    // drop parentheticals
  x = x.replace(/\s+with\s+.*$/, '');               // "hebrew with marginal glosses…" -> hebrew
  x = x.replace(/\s+in\s+[a-z' -]+script.*$/, '');  // "italian in italian script" -> italian
  x = x.replace(/[.)\]]+$/, '').trim();
  return VARIANTS[x] || x;
}

/** Split one raw label into its atomic, normalized languages. */
export function atomsOfLabel(label: string | null | undefined): string[] {
  if (!label) return [];
  const out: string[] = [];
  // Strong separators first: / ; , & and the word "and".
  for (let seg of String(label).split(/\s*(?:[;,/&]|\band\b)\s*/i)) {
    seg = seg.trim();
    if (!seg) continue;
    const lower = seg.toLowerCase();
    if (lower.includes('-') && !KEEP_HYPHEN.has(lower)) {
      for (const piece of lower.split('-')) {
        const a = normalizeAtom(piece);
        if (a) out.push(a);
      }
      continue;
    }
    const a = normalizeAtom(seg);
    if (a) out.push(a);
  }
  return out;
}

/** A normalized atom that is a real, nameable language (not junk/too short). */
function isRealAtom(atom: string): boolean {
  return !!atom && atom.length >= 2 && !JUNK.has(atom) && !atom.startsWith('multiple');
}

/**
 * True when `label` resolves to exactly ONE real language. Used to filter the
 * catalog language dropdown: single real languages keep their raw label (so the
 * exact-match filter still works), while junk ("e") and multi-language "collab"
 * labels ("Greek/Latin", "German-English", "Judeo-Arabic and Hebrew") drop out.
 */
export function isSingleRealLanguage(label: string | null | undefined): boolean {
  return atomsOfLabel(label).filter(isRealAtom).length === 1;
}

/** The set of distinct real languages across raw labels (compounds split out). */
export function distinctLanguageSet(rawLabels: Array<string | null | undefined>): Set<string> {
  const set = new Set<string>();
  for (const label of rawLabels) {
    for (const atom of atomsOfLabel(label)) {
      if (isRealAtom(atom)) set.add(atom);
    }
  }
  return set;
}

/** Honest distinct-language count for corpus stats. */
export function countDistinctLanguages(rawLabels: Array<string | null | undefined>): number {
  return distinctLanguageSet(rawLabels).size;
}
