/**
 * Shared morphology for early-modern personal names.
 *
 * Three modules independently grew their own copy of "fold a name and strip its
 * Latin ending": `author-reconcile.mjs` (May 2026, catalog matching),
 * `name-equivalence.mjs` (Aug 2026, attribution auditing), and the ad-hoc
 * folding inside several one-off scripts. This is the shared floor.
 *
 * WHAT IS SHARED AND WHAT IS DELIBERATELY NOT.
 *
 * The primitives below — accent folding, long-s repair, orthographic folding,
 * the particle list, and `stripEnding` — are genuinely common and live here.
 *
 * The ENDING LISTS do not merge, and the two consumers keep their own:
 *
 *   RECALL_ENDINGS    author-reconcile. One-to-many: "given a name, find its
 *                     authority cluster". Recall-first BY DESIGN — it may
 *                     surface a same-named decoy, and precision is held
 *                     downstream by a title gate and an LLM verifier.
 *
 *   PRECISION_ENDINGS name-equivalence. Pairwise: "are these two strings the
 *                     same person". Precision-first, because a false merge
 *                     deletes a real attribution error from a review queue
 *                     silently, where a false split costs a human ten seconds.
 *
 * Unioning them would change both callers' behaviour — widening the pairwise
 * predicate and narrowing nothing — so the lists stay separate and named after
 * the trade-off they encode. A "consolidation" that silently altered catalog
 * matching would be a worse outcome than two lists with a comment.
 */

/** Accent-fold, lowercase, punctuation to space. The common floor. */
/**
 * Apostrophe-family marks that transliteration uses INSIDE a word: ayn and hamza
 * (ʻ ʿ ʾ ʼ), the typographic quotes, and the bare ASCII apostrophe.
 *
 * These must be ELIDED, not turned into a space (#3950). Every other punctuation
 * mark here separates two things that really are separate; these sit inside a
 * single name. Replacing them with a space shatters short transliterations into
 * sub-floor fragments — `Saʻdī` becomes "sa"+"di", and since every length floor
 * in this module and its callers is 3 or 4, BOTH fragments are then discarded
 * and the name reduces to the empty set. An empty set is not "no match", it is
 * "cannot judge", and it reads downstream as guaranteed disagreement: that is
 * why `Saʻdī` vs `Saʿdī` — the same name, one codepoint apart — sat in the
 * person-vs-person queue as though it were two people.
 *
 * Elision is not a loosened floor. It changes what counts as ONE token, so the
 * name arrives at the floors intact ("sadi", 4 chars) instead of pre-shattered.
 * Names where the mark really does join separable parts (O'Brien → obrien) fold
 * to the same string either way.
 */
const ELIDED_MARKS = /[ʻʼʾʿ‘’ʹʺ`´′']/g;

export function foldAccents(s) {
  if (!s) return '';
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(ELIDED_MARKS, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Long-s OCR repair. The early-modern long s (ſ) is routinely transcribed as
 * "f", so "brandeburgenfis" is "brandeburgensis" and "Iofephus" is "Iosephus".
 * Returns the repaired form, or null when nothing changed — callers should try
 * BOTH the original and the repair rather than replacing one with the other,
 * since "f" is also just "f".
 */
export function foldLongS(token) {
  const repaired = String(token ?? '').replace(/f/g, 's');
  return repaired === token ? null : repaired;
}

/**
 * Orthographic folding for early-modern spelling. u/v and i/j are one letter
 * each in Latin type, y often stands for i, ae/oe are frequently written e, and
 * k/c alternate in Germanic transcription. Without this, Bodino and Bodinus are
 * strangers, and so are Boehme and Böhme.
 *
 * NOT applied by `author-reconcile`, whose authority index was built without it.
 */
export function foldOrthography(s) {
  return foldAccents(s)
    .replace(/ae/g, 'e').replace(/oe/g, 'e')
    .replace(/[vu]/g, 'u').replace(/[ijy]/g, 'i').replace(/k/g, 'c');
}

/** Particles, honorifics and role words that are never the distinctive name. */
export const PARTICLES = new Set([
  'de', 'del', 'della', 'dei', 'di', 'da', 'la', 'le', 'van', 'von', 'der', 'den',
  'du', 'des', 'el', 'al', 'ibn', 'ben', 'a', 'ab', 'zu', 'of', 'the', 'and',
  'don', 'fr', 'st', 'saint', 'sanctus', 'pseudo', 'trans', 'attributed',
]);

/** Recall-first endings — `author-reconcile`. Do not reorder: longest first. */
export const RECALL_ENDINGS = /(?:issimus|issima|orum|arum|ibus|ensis|enses|onis|ones|ius|eus|aeus|aei|ane|us|um|os|is|es|em|ae|i|o|a|e)$/;

/** Precision-first endings — `name-equivalence`. Longest first. */
export const PRECISION_ENDINGS = ['issimus', 'ensis', 'ibus', 'orum', 'arum', 'ius', 'eus', 'aus',
  'us', 'um', 'is', 'os', 'as', 'es', 'ae', 'am', 'em', 'im', 'on', 'o', 'a', 'e', 'i', 's'];

/**
 * Strip the first matching ending, leaving at least `minStem` characters.
 * Returns the word unchanged when nothing applies.
 */
export function stripEnding(word, endings = PRECISION_ENDINGS, minStem = 4) {
  for (const suf of endings) {
    if (word.length - suf.length >= minStem && word.endsWith(suf)) return word.slice(0, -suf.length);
  }
  return word;
}
