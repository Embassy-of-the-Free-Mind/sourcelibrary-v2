// Honest distinct-language count for corpus stats.
//
// The `books.language` field is free-text and messy: it mixes compound labels
// ("Hebrew and Judeo-Arabic", "Greek/Latin", "Latin-German"), script/stage
// variants ("Geez"/"Ge'ez", "Egyptian"/"Egyptian hieroglyphs"/"Demotic"),
// and junk tokens ("auto-detect", "Multiple", "mul", "Undetermined"). A naive
// `distinct('language').length` therefore badly over-counts — it reported 162
// when the real number of distinct languages with books is ~105 (2026-06-26).
//
// countDistinctLanguages(rawLabels) splits compounds into atomic languages,
// normalizes the obvious variants, drops the junk, and returns the honest count.
// Pass the array returned by `books.distinct('language', filter)`.

// Tokens that are not languages at all.
const JUNK = new Set([
  'auto-detect', 'auto', 'detect', 'multiple', 'mul', 'lit', 'undetermined',
  'unknown', 'various', 'various caucasian', 'n/a', 'zxx', 'roa', '',
]);

// Variant / stage / script labels folded into one canonical language.
const VARIANTS = {
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
const KEEP_HYPHEN = new Set([
  'judeo-arabic', 'judeo-greek', 'judeo-italian', 'judeo-occitan', 'judeo-persian',
  'anglo-norman', 'anglo-saxon',
]);

function normalizeAtom(raw) {
  let x = String(raw).trim().toLowerCase();
  x = x.replace(/\(.*?\)/g, '');                    // drop parentheticals
  x = x.replace(/\s+with\s+.*$/, '');               // "hebrew with marginal glosses…" -> hebrew
  x = x.replace(/\s+in\s+[a-z' -]+script.*$/, '');  // "italian in italian script" -> italian
  x = x.replace(/[.)\]]+$/, '').trim();
  return VARIANTS[x] || x;
}

// Split one raw label into its atomic languages.
export function atomsOfLabel(label) {
  if (!label) return [];
  const out = [];
  // Strong separators first: / ; , & and the word "and".
  for (let seg of String(label).split(/\s*(?:[;,/&]|\band\b)\s*/i)) {
    seg = seg.trim();
    if (!seg) continue;
    const lower = seg.toLowerCase();
    if (lower.includes('-') && !KEEP_HYPHEN.has(lower)) {
      // Hyphen compound (e.g. "Latin-German", "Nahuatl-Spanish") -> split.
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

export function distinctLanguageSet(rawLabels) {
  const set = new Set();
  for (const label of rawLabels) {
    for (const atom of atomsOfLabel(label)) {
      if (!atom || atom.length < 2 || JUNK.has(atom) || atom.startsWith('multiple')) continue;
      set.add(atom);
    }
  }
  return set;
}

export function countDistinctLanguages(rawLabels) {
  return distinctLanguageSet(rawLabels).size;
}
