/**
 * Are these two strings the same PERSON under a different name-form? (#3894)
 *
 * The corpus records one person many ways. A source catalogue says "Cicéron",
 * enrichment reads "Cicero" off the page, a title page prints "Ciceronis". Exact
 * token comparison calls those three different people, which is how a quarter of
 * the first `author-vs-ai-metadata.mjs` review queue turned out to be the
 * corpus's own historiography rather than a defect: Aristoteles/Aristotle,
 * Boehme/Böhme, Claude de Saumaise/Claudius Salmasius, Ovid/Publius Ovidius
 * Naso, Dioscorides/Pedanius Dioscurides Anazarbeus.
 *
 * This is deliberately ORTHOGRAPHIC ONLY. It does not know that Paracelsus is
 * Theophrastus von Hohenheim, or that Iamblichus and Jamblichus are conventional
 * transliterations of one Greek name where the vernacular forms have diverged
 * beyond one edit. Those belong to the `authors` thesaurus (`variants[]`), which
 * is the corpus's actual authority for identity; callers should try both and
 * treat this as the cheap first pass.
 *
 * It also cannot judge non-Latin scripts at all — `foldOrtho` strips them, so two
 * CJK names both reduce to empty and the functions return false. Callers must
 * detect that case separately rather than read false as "different people".
 */

/**
 * Early-modern orthography, folded. u/v and i/j are one letter each in Latin
 * type; y often stands for i; ae/oe are frequently written e; k and c alternate
 * in Germanic transcription. Without this, Bodino and Bodinus are strangers.
 */
import { foldOrthography, foldLongS, PARTICLES, PRECISION_ENDINGS, stripEnding } from './latin-morphology.mjs';

export const foldOrtho = foldOrthography;

/**
 * Particles and role words. These recur across unrelated names, so leaving them
 * in manufactures agreement — every "de" would match every other "de".
 */
export const NAME_STOP = PARTICLES;

/** Strip one Latin case ending so Bodinus/Bodini/Bodino share a stem. */
export const latinStem = (w) => stripEnding(w, PRECISION_ENDINGS, 4);

/** Distinctive stems of a name: 4+ characters, particles dropped. */
export const nameStems = (s) => new Set(foldOrtho(s).split(' ')
  .filter((w) => w.length >= 4 && !NAME_STOP.has(w)).map(latinStem));

/** Levenshtein distance ≤ 1, without building a matrix. */
export function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Same person by name-form?
 *
 * Three rules, each with a length floor, because every one of them is unsafe on
 * short tokens — "Otto" and "Otho" are one edit apart and so are plenty of
 * distinct given names:
 *
 *   exact stem match            any length (already survived folding + stemming)
 *   one stem prefixes the other ≥5 chars — Dioscorid ⊂ Dioscorides
 *   one edit apart              ≥7 chars — Aristotel/Aristotl, Dioscorid/Dioscurid,
 *                               which no prefix or suffix rule can reach because
 *                               the character that differs is in the middle
 *
 * Only ONE stem pair needs to agree: a shared surname is identity even when the
 * given names are recorded differently ("Boehme, Jacob" vs "Jakob Böhme").
 */
export function sameNameForm(a, b) {
  const A = nameStems(a);
  const B = nameStems(b);
  if (!A.size || !B.size) return false;
  // The long s (ſ) is routinely transcribed "f", so a stem may only agree after
  // repair: "Iofephus"/"Iosephus", "brandeburgenfis"/"brandeburgensis". Compare
  // both forms — `author-reconcile` has done this since May and this module
  // shipped without it, so OCR'd names failed to match their clean spelling.
  for (const set of [A, B]) {
    for (const t of [...set]) {
      const repaired = foldLongS(t);
      if (repaired && repaired.length >= 4) set.add(repaired);
    }
  }
  for (const t of A) {
    for (const u of B) {
      if (t === u) return true;
      const shortest = Math.min(t.length, u.length);
      if (shortest >= 5 && (t.startsWith(u) || u.startsWith(t))) return true;
      if (shortest >= 7 && withinOneEdit(t, u)) return true;
    }
  }
  return false;
}
