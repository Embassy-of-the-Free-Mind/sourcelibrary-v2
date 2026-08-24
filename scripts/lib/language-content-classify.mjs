/**
 * Stopword/script language classifier for OCR'd page text.
 *
 * Extracted verbatim from `scripts/maintenance/classify-language-mismatch-content.mjs`
 * (#2534, 2026-06-16) so the `language_review` triage (#3958) can reuse it instead
 * of growing a second copy. Behaviour is unchanged — the densities, the ranking
 * and the reliability gate are the ones that script has always used.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT
 * ------------------------------------
 * This reads the *body text* and measures stopword density plus Greek/Cyrillic
 * script ratio. It is the FALLBACK signal. The primary signal for a book's
 * language mix is the per-page OCR `<language>` tag, aggregated by
 * `scripts/audit/detect-book-languages.mjs` (#4117) — that is real per-page
 * detection, already paid for, and it covers scripts this classifier is blind to.
 *
 * Use this only where the tag cannot answer: books whose OCR predates the tag
 * (`no_tag`) or that have too few tagged pages (`thin`).
 *
 * THE BLIND SPOT IS THE IMPORTANT PART. `RELIABLE_CATALOGUE_LANGS` exists because
 * this classifier can only read Latin-script bodies plus Greek and Cyrillic. For
 * Arabic, Hebrew, Sanskrit, Chinese, Coptic or Syriac the body is *invisible* to
 * it, so a near-zero density for the catalogued language is an artifact of the
 * instrument, not evidence that the language is absent. Judging those would
 * manufacture mislabels. Gate on this set before drawing any conclusion.
 *
 * See `.claude/docs/invariants/language-fields.md`.
 */

/** Stopword lists, one per readable language. Deliberately short and common. */
const SW = {
  latin: 'et in est non cum ad qui quod sed ut ex per sunt enim hoc esse si aut nam atque ab de quae quam ipse autem'.split(' '),
  german: 'der die das und ist von zu den nicht mit auch ein eine auf im dem sich des wird werden für als aus dass nach bei'.split(' '),
  french: 'le la les de des et que qui une dans pour est par sur plus au aux ce il ne pas nous avec son ont été cette'.split(' '),
  italian: 'il la di che un per non con del della le si nel gli come questo sono anche più ma suo nella delle alla'.split(' '),
  spanish: 'el la de que los las en un una por con del se su para es como más al sus este entre cuando muy sin'.split(' '),
  dutch: 'de het een van en in is dat op te met voor niet zijn aan die ook als maar door werd wordt deze'.split(' '),
  english: 'the and of to in is that it was as with for his by this are be or from at on which have'.split(' '),
};
const swSets = Object.fromEntries(Object.entries(SW).map(([k, v]) => [k, new Set(v)]));

/**
 * Catalogue languages whose *body* this classifier can actually read. Outside
 * this set a low density means "wrong instrument", never "wrong catalogue".
 */
export const RELIABLE_CATALOGUE_LANGS = new Set(['latin', 'greek']);

/** Classifier keys -> canonical English language names. */
const FMT = {
  german: 'German', french: 'French', italian: 'Italian', spanish: 'Spanish',
  dutch: 'Dutch', english: 'English', greek: 'Greek', russian: 'Russian',
  latin: 'Latin',
};

/** Turn a classifier key (`'german'`) into a canonical catalogue name (`'German'`). */
export function formatDetectedLanguage(key) {
  return FMT[key] || key;
}

/**
 * Lowercase a catalogue language to a classifier key. Intentionally minimal —
 * the canonical normaliser lives in `language-normalize.mjs`; this only has to
 * agree with the keys of `SW`.
 */
export function toClassifierKey(raw) {
  const s = String(raw || '').toLowerCase().trim();
  return ({ 'ancient greek': 'greek', eng: 'english' })[s] || s;
}

/** Drop the OCR metadata block so tags never vote on the body's language. */
export function stripOcrMetadata(t) {
  return (t || '')
    .replace(/<(meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/**
 * Measure per-language density for one page of OCR text.
 * Returns the dominant key, its score, the full density map, and the word count
 * (the caller needs `words` to weight pages when aggregating across a sample).
 */
export function classifyLanguageContent(text) {
  const t = stripOcrMetadata(text);
  const greek = (t.match(/[Ͱ-Ͽἀ-῿]/g) || []).length;
  const cyr = (t.match(/[Ѐ-ӿ]/g) || []).length;
  const latinCh = (t.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  const words = (t.toLowerCase().match(/[a-zà-ÿ]+/g) || []);
  const total = words.length || 1;
  const dens = {};
  for (const [k, set] of Object.entries(swSets)) dens[k] = words.filter((w) => set.has(w)).length / total;
  dens.greek = greek / (greek + latinCh + cyr + 1);
  dens.russian = cyr / (greek + latinCh + cyr + 1);
  const ranked = Object.entries(dens).sort((a, b) => b[1] - a[1]);
  return { dominant: ranked[0][0], score: ranked[0][1], dens, words: total };
}

/**
 * Aggregate several pages into one verdict, weighting each page by its word
 * count. Mirrors the sampling the #2534 script has always done.
 */
export function classifyPageSample(texts) {
  const agg = {};
  let totalWords = 0;
  for (const text of texts) {
    const r = classifyLanguageContent(text);
    for (const [k, v] of Object.entries(r.dens)) agg[k] = (agg[k] || 0) + v * r.words;
    totalWords += r.words;
  }
  for (const k of Object.keys(agg)) agg[k] /= (totalWords || 1);
  const ranked = Object.entries(agg).sort((a, b) => b[1] - a[1]);
  return { dominant: ranked[0]?.[0] ?? null, score: ranked[0]?.[1] ?? 0, dens: agg, words: totalWords };
}
