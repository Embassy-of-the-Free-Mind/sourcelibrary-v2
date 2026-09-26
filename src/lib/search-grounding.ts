/**
 * Search grounding: a result may be shown for a query only if the query's
 * words appear in the result's OWN text.
 *
 * PRIOR ART: src/lib/align-text.ts normalizeNeedle — reused below for folding
 * (case, diacritics, ligatures, long-s), but it locates spans and has no notion
 * of query words or word boundaries. src/lib/concept-aliases.ts foldTerm folds
 * Latin only, for alias lookup. Neither answers "does this item match".
 *
 * Why this exists (2026-09-26): gallery search merges several lanes, and every
 * non-literal lane leaked unrelated images. A semantic lane put Balinese wayang
 * figures under "mushroom" and armillary clocks under "smartphone" (no score
 * threshold separates those from real hits); a substring lane matched "rose"
 * inside "arose" and "prose" in William Blake's engraved text. Tuning each lane
 * fixes one symptom; this predicate is enforced once, at the response boundary,
 * so a lane added later cannot bypass it.
 *
 * Non-Latin (see .claude/docs/invariants/non-latin-text-operations.md):
 *  - words are runs of letters, marks and digits in ANY script (\p{L}\p{M}\p{N});
 *  - scripts written without spaces (Han, kana, Hangul, Thai, Lao, Khmer,
 *    Myanmar, Tibetan) have no word boundary to test, so their terms match as a
 *    contiguous substring;
 *  - a query that reduces to no terms is UNJUDGEABLE: nothing is grounded,
 *    rather than everything.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Mongo docs of two shapes (gallery_images, artworks) */

import { normalizeNeedle } from '@/lib/align-text';

// Function words in the library's main catalogue languages. Dropped from a
// multi-word query so "the green lion" requires green AND lion, not "the".
const STOPWORDS = new Set([
  // en
  'a', 'an', 'and', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'or', 'as', 'is',
  // la
  'et', 'ac', 'atque', 'cum', 'de', 'ex', 'e', 'ad', 'per', 'que',
  // fr / it / es / pt
  'le', 'la', 'les', 'l', 'des', 'du', 'd', 'un', 'une', 'il', 'lo', 'gli', 'di', 'da', 'del', 'della', 'el', 'los', 'las', 'y', 'o', 'do', 'dos', 'das',
  // de / nl
  'der', 'die', 'das', 'und', 'ein', 'eine', 'von', 'zu', 'het', 'een', 'van', 'en', 'op',
]);

/** normalizeNeedle, plus Greek final sigma folded to σ (ΑΓΓΕΛΟΣ must match ἄγγελος). */
const fold = (s: string): string => normalizeNeedle(s).replace(/ς/g, 'σ');

const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u;
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

export interface QueryTerms {
  /** Folded terms, every one of which must be present. */
  terms: string[];
  /** False when the query reduced to nothing checkable. */
  judgeable: boolean;
}

export function queryTerms(query: string): QueryTerms {
  const words = fold(query ?? '').match(WORD) ?? [];
  const content = words.filter(w => !STOPWORDS.has(w));
  // A query made only of function words ("the") still means something literal.
  const terms = [...new Set(content.length > 0 ? content : words)];
  return { terms, judgeable: terms.length > 0 };
}

/** Whether a term is from a script without word spaces (matched as a substring). */
export function isNoSpaceTerm(term: string): boolean {
  return NO_SPACE_SCRIPT.test(term);
}

/**
 * Surface forms accepted for one term: itself, and simple English/Romance
 * plural and singular pairs (rose/roses, fly/flies, fox/foxes). Deliberately
 * NOT prefix matching: "cat" must not match "cathedral", "rose" not "rosette".
 */
export function termVariants(term: string): string[] {
  const v = new Set([term, `${term}s`, `${term}es`]);
  if (term.length >= 3 && /[^aeiou]y$/.test(term)) v.add(`${term.slice(0, -1)}ies`); // fly/flies; day/days via +s
  if (term.length > 4 && term.endsWith('ies')) v.add(`${term.slice(0, -3)}y`);
  if (term.length > 4 && term.endsWith('es')) v.add(term.slice(0, -2));
  if (term.length > 3 && term.endsWith('s') && !term.endsWith('ss')) v.add(term.slice(0, -1));
  return [...v];
}

interface Folded { hay: string; words: Set<string> }
const prepare = (text: string): Folded => { const hay = fold(text); return { hay, words: new Set(hay.match(WORD) ?? []) }; };
const termIn = (f: Folded, t: string): boolean => (isNoSpaceTerm(t) ? f.hay.includes(t) : termVariants(t).some(v => f.words.has(v)));

/** True when every query term appears in `text` (see module doc). */
export function textMatchesQuery(text: string | null | undefined, q: QueryTerms): boolean {
  if (!q.judgeable || !text) return false;
  const f = prepare(text);
  return f.hay.length > 0 && q.terms.every(t => termIn(f, t));
}

// ---- what counts as an item's OWN text, and how strong each field is ---------

const joinText = (...parts: unknown[]): string =>
  parts.flat(2).filter(p => typeof p === 'string' && p).join(' \n ');

/**
 * An item's own text, split by how strongly a match there says "this image is
 * about the query". Also the ranking model for "Best match": the Atlas lane
 * boosts the same fields by the same weights, so the database order and the
 * page-1 merge agree.
 */
export interface EvidenceFields {
  /** Curated tags: what the image depicts (subjects, figures, symbols). */
  tags?: string;
  /** An artwork's own title. */
  title?: string;
  description?: string;
  /** Museum/catalogue prose: often context rather than content. */
  secondary?: string;
  /** Words written ON the object (e.g. a food list on a measles print). */
  inscriptions?: string;
}

export const EVIDENCE_WEIGHTS: Required<{ [K in keyof EvidenceFields]: number }> = {
  tags: 4, title: 3, description: 2, secondary: 1, inscriptions: 0.5,
};
/** Extra credit when a term is in the opening of the description (what it is ABOUT). */
const LEAD_BONUS = 1;
const LEAD_CHARS = 160;

/**
 * 0 when the item is not grounded (some query term appears nowhere in its own
 * text); otherwise the summed weight of every field each term appears in.
 */
export function evidenceScore(fields: EvidenceFields, q: QueryTerms): number {
  if (!q.judgeable) return 0;
  const all = joinText(Object.values(fields));
  if (!textMatchesQuery(all, q)) return 0;
  let score = 0;
  for (const [k, w] of Object.entries(EVIDENCE_WEIGHTS) as [keyof EvidenceFields, number][]) {
    const text = fields[k];
    if (!text) continue;
    const f = prepare(text);
    for (const t of q.terms) if (termIn(f, t)) score += w;
    if (k === 'description') {
      const lead = prepare(text.slice(0, LEAD_CHARS));
      for (const t of q.terms) if (termIn(lead, t)) score += LEAD_BONUS;
    }
  }
  return score;
}

/**
 * A gallery_images row. Deliberately excludes book_title / book_author: a plate
 * from a book titled "The Rose" is not therefore a picture of a rose.
 * These are the fields the Atlas `gallery_search` lane searches (plus symbols).
 */
export function plateFields(doc: Record<string, any>): EvidenceFields {
  const m = doc.metadata ?? {};
  return { tags: joinText(m.subjects, m.figures, m.symbols), description: doc.description, secondary: doc.museum_description };
}

/** A standalone artwork (books row, content_type 'artwork'). Its title is its own. */
export function artworkFields(doc: Record<string, any>): EvidenceFields {
  const e = doc.enrichment ?? {};
  const summary = typeof doc.summary === 'string' ? doc.summary : doc.summary?.data;
  // Field names as stored by scripts/artwork-enrichment.mjs (measured 2026-09-26):
  // subject (singular), figures_depicted, symbols.
  return {
    tags: joinText(e.subject, e.figures_depicted, e.symbols),
    title: joinText(doc.title, doc.display_title),
    description: joinText(doc.description, summary, e.description),
    secondary: joinText(e.museum_description, e.significance),
    inscriptions: joinText(e.inscriptions, e.inscriptions_translation),
  };
}
