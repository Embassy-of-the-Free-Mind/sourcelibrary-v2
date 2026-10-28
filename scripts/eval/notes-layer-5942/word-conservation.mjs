/**
 * Word conservation for the notes layer (#5942): does `text` hold exactly the book's words of the
 * stored markup — none lost, and no word of the model's notes leaking in?
 *
 * PRIOR ART: measure-a.mts (this directory) compares `text` with today's notes-off reader, which
 * is a different question: that reader itself shows a note nested in a margin as book text (55 of
 * 79 differences there), so agreeing with it is not the same as being right. This counts words
 * against the markup directly, independent of any renderer.
 *
 * The ledger, per word (letters and digits, Unicode-aware, case kept):
 *   expected(w) = count in the markup with every tag removed
 *               − count in the bodies of the commentary and page annotations the split removed
 *               − count in the `term` of glossary-line entries (the whole line leaves the text)
 *   lost   = words with text(w) < expected(w)  (book words gone)
 *   leaked = words with text(w) > expected(w)  (words in text that the ledger says are notes)
 * The same ledger over characters (letters, marks, digits) is returned too: a tag inside a word
 * (`<unclear>ek</unclear>tinō`) splits it into two words in the markup and joins them in the text,
 * which the word ledger reports as one lost + one leaked; the character ledger does not.
 * Pages whose term definitions were lifted (termDefinitionsLifted > 0) are not comparable — the
 * lift rewrites the input before the split — and are reported apart.
 */

const TAGS = /<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>|\[\[[a-z ]+:|\]\]/gi;
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

function bag(s, unit = 'word') {
  const m = new Map();
  const words = String(s ?? '').replace(TAGS, ' ').match(WORD) || [];
  for (const w of unit === 'word' ? words : [...words.join('')]) m.set(w, (m.get(w) || 0) + 1);
  return m;
}

function ledger(markup, split, unit) {
  const expected = bag(markup, unit);
  for (const a of split.annotations) {
    if (a.malformed) continue;
    if (a.kind !== 'commentary' && a.kind !== 'page') continue;
    for (const [w, n] of bag(a.body, unit)) expected.set(w, (expected.get(w) || 0) - n);
    if (a.glossary) for (const [w, n] of bag(a.term, unit)) expected.set(w, (expected.get(w) || 0) - n);
  }
  const got = bag(split.text, unit);
  const lost = [], leaked = [];
  for (const w of new Set([...expected.keys(), ...got.keys()])) {
    const e = Math.max(0, expected.get(w) || 0), g = got.get(w) || 0;
    if (g < e) lost.push([w, e - g]);
    else if (g > e) leaked.push([w, g - e]);
  }
  return { lost, leaked };
}

/**
 * @param {string} markup the stored translation.data
 * @param {{ text: string, annotations: any[], termDefinitionsLifted?: number }} split splitAnnotations(markup)
 */
export function wordConservation(markup, split) {
  if (split.termDefinitionsLifted) return { comparable: false, lost: [], leaked: [], chars_lost: 0, chars_leaked: 0 };
  const w = ledger(markup, split, 'word');
  const c = ledger(markup, split, 'char');
  const sum = (xs) => xs.reduce((n, [, k]) => n + k, 0);
  return { comparable: true, lost: w.lost, leaked: w.leaked, chars_lost: sum(c.lost), chars_leaked: sum(c.leaked) };
}
