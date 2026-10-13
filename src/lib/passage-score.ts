/**
 * Score pages against a query so that the page carrying the passage wins.
 *
 * ## The failure this replaces
 *
 * Reported from a live session, with controlled tests (#3653 follow-up #5):
 *
 *   > "Two unrelated queries on Taylor's Metaphysics — one about the whole not
 *   > being a heap, one about Speusippus and seed — returned an IDENTICAL page
 *   > set: 9, 10, 11 … 61, same order, match_count pinned at 12 for nearly every
 *   > result. Control: 'zebra pancake velocipede submarine trombone' → total 0,
 *   > so matching is happening. Single rare term 'Speusippus' → pages 217, 347,
 *   > 410, all correct."
 *
 * And the consequence they drew, which is the part worth keeping in mind:
 *
 *   > "The more precisely a caller describes the passage they want, the worse
 *   > the search performs. The tool description invites natural-language
 *   > queries, which is the worst input format for the current implementation."
 *
 * Two independent causes, both real:
 *
 * 1. **Ranking was `matches.length`** — a raw count of snippet windows, with no
 *    weighting by how rare a term is and no correction for page length. A
 *    fifty-page introduction discussing the Metaphysics says "whole" and "parts"
 *    dozens of times; the actual passage says each once, in one sentence.
 *
 * 2. **Matching was `indexOf`, i.e. SUBSTRING** — so the query word "a" matched
 *    inside every word on every page, and "is" matched "this" and "his". That is
 *    why two unrelated natural-language queries returned the same page set: the
 *    function words alone saturate any page of continuous prose.
 *
 * ## Why there is no stopword list here
 *
 * The obvious fix is to drop "the, is, of, and". It is the wrong fix for THIS
 * corpus, which is substantially Greek, Latin, Hebrew, Arabic and early modern
 * English — a curated English stopword list would help one language and do
 * nothing for the volumes where the problem is worst (the Aldine, the Bekker).
 *
 * Instead the document frequency is computed **over the candidate pages of the
 * book being searched**, and rare terms are weighted up (standard BM25 IDF). A
 * term appearing on every candidate page earns a weight at or below zero and
 * stops mattering, whatever language it is in and whether or not anyone
 * remembered to list it. Function words are excluded by measurement rather than
 * by vocabulary. καί and que fall out for free.
 *
 * Length normalisation (the `b` term) is what stops a 900-word introduction page
 * from beating a 200-word page of body text, which was the reporter's own
 * suggested fix and is the same reason BM25 exists.
 *
 * ## Proximity
 *
 * BM25 is a bag of words, so a page repeating "plausible" six times in scattered
 * places outranks the page carrying "plausible impossibilities" verbatim — the
 * reporter's SECONDARY 1, measured on Aldine p.705, which held the exact target
 * sentence and ranked LAST of eight. A contiguity bonus fixes that: distinct
 * query terms occurring close together are worth more than the same terms spread
 * across a page. It is a bonus, not a filter, so a genuine paraphrase still ranks.
 */

/** k1 controls how fast term frequency saturates; b how hard length is penalised. */
const K1 = 1.2;
const B = 0.75;

/** Terms within this many characters of each other count as contiguous. */
const PROXIMITY_WINDOW = 120;

/** Largest bonus proximity can add, as a fraction of the BM25 score. */
const MAX_PROXIMITY_BONUS = 0.6;

/**
 * Fold to a comparable form: lowercase, and strip combining marks so Greek
 * accents and breathings, and Latin macrons, do not defeat a match. This mirrors
 * the `standard_diacritic` analyser the Atlas index uses, so the scorer and the
 * retriever agree about what counts as the same word.
 */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/**
 * Split into word tokens. Unicode-aware, so Greek and Cyrillic tokenise as words
 * rather than as one undifferentiated blob.
 */
export function tokenize(s: string): string[] {
  return fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export interface ScoredPage<T> {
  item: T;
  score: number;
  /** Distinct query terms actually present — surfaced so a caller can judge a hit. */
  matched_terms: string[];
}

interface Prepared<T> {
  item: T;
  /** Length in tokens — the denominator that stops long pages winning by bulk. */
  length: number;
  /** Occurrences per query term. */
  tf: Map<string, number>;
  /** Character offset of each occurrence, per term, for the proximity bonus. */
  offsets: Map<string, number[]>;
}

function prepare<T>(item: T, text: string, queryTerms: Set<string>): Prepared<T> {
  const folded = fold(text);
  const offsets = new Map<string, number[]>();
  const tf = new Map<string, number>();
  let length = 0;

  // One pass: token boundaries are what make this word-matching rather than the
  // substring matching it replaces, so "a" no longer hits inside every word.
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(folded)) !== null) {
    length++;
    const tok = m[0];
    if (!queryTerms.has(tok)) continue;
    tf.set(tok, (tf.get(tok) ?? 0) + 1);
    const at = offsets.get(tok);
    if (at) at.push(m.index);
    else offsets.set(tok, [m.index]);
  }

  return { item, length, tf, offsets };
}

/**
 * How tightly do the distinct matched terms cluster? Returns 0 (scattered or
 * only one term present) to 1 (two or more distinct terms adjacent).
 *
 * Deliberately cheap: for each occurrence of each term, look for the nearest
 * occurrence of any OTHER query term. A page where two content words sit in the
 * same clause scores near 1; a page mentioning each of them once, forty lines
 * apart, scores 0.
 */
function proximity(offsets: Map<string, number[]>): number {
  const terms = [...offsets.keys()];
  if (terms.length < 2) return 0;

  let best = Infinity;
  for (let i = 0; i < terms.length; i++) {
    for (let j = i + 1; j < terms.length; j++) {
      for (const a of offsets.get(terms[i])!) {
        for (const b of offsets.get(terms[j])!) {
          const d = Math.abs(a - b);
          if (d < best) best = d;
        }
      }
    }
  }
  if (!Number.isFinite(best) || best > PROXIMITY_WINDOW) return 0;
  return 1 - best / PROXIMITY_WINDOW;
}

/**
 * Rank pages by BM25 with a contiguity bonus, using document frequency measured
 * over the candidate set itself.
 *
 * `candidates` should be the OVER-FETCHED pool, not a page-ordered prefix of it —
 * the whole point is that the pool is scored before it is cut. Returns every
 * candidate that matched at least one query term, best first; a caller applies
 * its own cap.
 */
export function scorePages<T>(
  query: string,
  candidates: Array<{ item: T; text: string }>,
): Array<ScoredPage<T>> {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || candidates.length === 0) return [];
  const termSet = new Set(queryTerms);

  const prepared = candidates.map((c) => prepare(c.item, c.text, termSet));
  const N = prepared.length;
  const avgLen = prepared.reduce((s, p) => s + p.length, 0) / N || 1;

  // Document frequency over the candidate pool. This is what makes function
  // words free: a term on every candidate page gets idf <= 0 and contributes
  // nothing, in any language, with no list to maintain.
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    df.set(term, prepared.reduce((n, p) => n + (p.tf.has(term) ? 1 : 0), 0));
  }
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const d = df.get(term)!;
    // Standard BM25 IDF. Clamped at 0 so a term present everywhere is inert
    // rather than actively penalising the pages that carry it.
    idf.set(term, Math.max(0, Math.log(1 + (N - d + 0.5) / (d + 0.5))));
  }

  // If every term is on every page the whole query is function words. Rather
  // than return an arbitrary order, fall back to raw term coverage so the caller
  // still gets something ordered by how much of the query is present.
  const anyDiscriminating = queryTerms.some((t) => (idf.get(t) ?? 0) > 0);

  const out: Array<ScoredPage<T>> = [];
  for (const p of prepared) {
    if (p.tf.size === 0) continue;

    let score = 0;
    for (const [term, freq] of p.tf) {
      const weight = anyDiscriminating ? idf.get(term)! : 1;
      if (weight === 0) continue;
      score += weight * ((freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (p.length / avgLen))));
    }
    if (score > 0) score *= 1 + MAX_PROXIMITY_BONUS * proximity(p.offsets);

    out.push({ item: p.item, score, matched_terms: [...p.tf.keys()] });
  }

  return out.sort((a, b) => b.score - a.score);
}

/**
 * ## Word order, for the corpus-wide passage search (#3700)
 *
 * `scorePages` above replaces a ranker that had none. This is for the opposite
 * case: Atlas has already ranked the candidates with corpus-wide BM25, which is
 * better than anything computable from a pool (rescoring it moved a wanted page
 * from #1 to #366), but BM25 is a bag of words. "to educate the mind without
 * educating the heart" came back as 27 pages that each print "educate", "mind"
 * and "heart" somewhere, none of them together.
 *
 * So this measures the one thing Atlas's score does not carry: how much of the
 * query a page prints IN ONE PLACE, IN ORDER. A run is consecutive query words
 * found in sequence, with at most `SEQUENCE_SLOP` other words between two of
 * them; a page is scored on its best single run. Two halves of the query in
 * two different paragraphs are not the query, so they are not added together.
 *
 * A run is worth the adjacent pairs and triples of query words inside it, each
 * weighted by how rare it is in the candidate pool. So "of the" and "what is a"
 * are worth almost nothing and "merely a heap" is worth a great deal, again
 * with no stopword list and in any language.
 *
 * The result is ABSOLUTE, not normalised to the best candidate (#3699): the
 * denominator is every pair and triple the query has, including those no page
 * prints. 1 means the page carries the whole query in order; 0 means its words
 * occur only scattered. A query nothing answers scores 0 everywhere.
 *
 * Asking Atlas for the same thing (a `phrase` clause per triple) ranks equally
 * well and was measured at 2x the query time on a lane with an 8s ceiling,
 * 12-17s cold, 2026-10-12. Hence here, over text already fetched.
 */

/** Other words allowed between two consecutive words of a run. */
const SEQUENCE_SLOP = 1;

/** Query words read; a longer query is a pasted paragraph and its head is enough. */
const MAX_SEQUENCE_WORDS = 24;

export interface PhraseMatch {
  /** 0-1: rarity-weighted share of the query printed in order at one place on the page. */
  match: number;
  /** Where that run sits in the text (character offsets), for the snippet. */
  start: number;
  end: number;
}

interface Occurrence { index: number; start: number; end: number }

/** Follow `words[from..]` from `head` for as long as the next word is close by. */
function extend(words: string[], from: number, head: Occurrence, at: Map<string, Occurrence[]>, max: number): { to: number; last: Occurrence } {
  let cur = head;
  let k = from + 1;
  for (; k < words.length && k - from < max; k++) {
    const next = at.get(words[k])?.find((o) => o.index > cur.index && o.index <= cur.index + 1 + SEQUENCE_SLOP);
    if (!next) break;
    cur = next;
  }
  return { to: k - 1, last: cur };
}

/**
 * Score each text for how much of the query it prints in order at one place.
 * Returns one entry per text, in the order given; an empty array when the
 * query has fewer than two words (a single word has no order to match).
 */
export function phraseMatch(query: string, texts: string[]): PhraseMatch[] {
  const words = tokenize(query).slice(0, MAX_SEQUENCE_WORDS);
  if (words.length < 2 || texts.length === 0) return [];
  const terms = new Set(words);

  const occurrences = texts.map((text) => {
    // Tokens are folded one at a time so the offsets stay those of `text`,
    // which is what the snippet is cut from. \p{M} keeps a decomposed accent
    // inside its word.
    const at = new Map<string, Occurrence[]>();
    const re = /[\p{L}\p{M}\p{N}]+/gu;
    let m: RegExpExecArray | null;
    let index = 0;
    while ((m = re.exec(text)) !== null) {
      const tok = fold(m[0]);
      if (terms.has(tok)) {
        const occ = { index, start: m.index, end: m.index + m[0].length };
        const list = at.get(tok);
        if (list) list.push(occ);
        else at.set(tok, [occ]);
      }
      index++;
    }
    return at;
  });

  // Weight of the pair and of the triple starting at each query position, from
  // how many candidate texts print it. One nobody prints gets the largest
  // weight, which is what keeps the score absolute.
  const N = texts.length;
  const weightOf = (n: number) => words.map((_, i) => {
    if (i + n > words.length) return 0;
    let d = 0;
    for (const at of occurrences) {
      if (at.get(words[i])?.some((head) => extend(words, i, head, at, n).to === i + n - 1)) d++;
    }
    return Math.log(1 + (N - d + 0.5) / (d + 0.5));
  });
  const pair = weightOf(2);
  const triple = weightOf(3);
  const total = [...pair, ...triple].reduce((a, b) => a + b, 0);

  const credit = (from: number, to: number) => {
    let sum = 0;
    for (let p = from; p < to; p++) sum += pair[p];
    for (let p = from; p + 1 < to; p++) sum += triple[p];
    return sum;
  };

  return occurrences.map((at) => {
    let best = { match: 0, start: 0, end: 0 };
    if (at.size === 0) return best;
    for (let i = 0; i + 1 < words.length; i++) {
      for (const head of at.get(words[i]) ?? []) {
        const run = extend(words, i, head, at, words.length);
        if (run.to === i) continue;
        const match = credit(i, run.to) / total;
        if (match > best.match) best = { match, start: head.start, end: run.last.end };
      }
    }
    return best;
  });
}
