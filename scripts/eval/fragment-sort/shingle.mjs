// PRIOR ART: scripts/eval/fragment-sort/classify.mjs (#7065) — these helpers were inline there; moved here unchanged so
// scripts/eval/harmony-census/ (#7117) can match text with the same folding and shingles instead of a second matcher.
// Fold Greek and Latin for n-gram overlap: no accents/breathings, final sigma, u/v, i/j, ae/oe, letters only.
export const fold = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ̓̔͂ͅ]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ').replace(/ſ/g, 's').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
    .replace(/v/g, 'u').replace(/j/g, 'i').replace(/ae/g, 'e').replace(/oe/g, 'e')
    .replace(/[^a-zα-ω]/g, '');

// Cut the text at NAMES (a /g regex over the raw text) so no shingle spans a name, then fold; '|' marks a cut.
export const makeFolded = (NAMES) => (s) => s.split(NAMES).map(fold).join('|');

// Set of K-character shingles of the folded text that cross no cut and contain no folded name.
export const makeShingles = (folded, K, NAMES_FOLDED) => (s) => {
  const f = folded(s), out = new Set();
  for (let i = 0; i + K <= f.length; i++) { const g = f.slice(i, i + K); if (!g.includes('|') && !(NAMES_FOLDED && NAMES_FOLDED.test(g))) out.add(g); }
  return out;
};
