/**
 * PRIOR ART: scripts/eval/confidence-7866/frame.mjs draw() — one random page from each fifth of a book (#7866); this
 * keeps that frame and adds the page next to each pick, so every pair carries one page join. Its eligibility rule
 * (confidence-7866/lib.mjs eligiblePage) stays with the caller. scripts/lib/paired-fifths.mjs is the same rule for
 * scripts; src/lib/__tests__/paired-fifths.test.ts pins the two equal.
 *
 * The paired-fifths draw (#8405): 10 pages of a book, two adjacent pages from each fifth.
 *
 * Why pairs: one page per fifth grades a book (5 pages, reliability 0.75 at ICC 0.38, #7866) but never sees a page
 * join, and text carried over from another page is the commonest "invented" flag. A pair is one join.
 *
 * The rule, for fifth k of the book's page sequence (by position among ALL its pages, as #7866):
 *   - candidates: eligible pages in the fifth, not already used, with an eligible unused neighbour;
 *   - anchor: one candidate, drawn with mulberry32 seeded from `seedKey` (the book id, so every reader of a book
 *     reads the same pages and their verdicts can be compared);
 *   - partner: the next page if eligible and unused, else the previous one. The partner may sit in the next fifth.
 * The anchors alone are a one-per-fifth draw, so a 5-page grade can still be read off a paired check.
 * A fifth with no candidate yields no pair: a short or sparse book gets fewer than 5 pairs, and the caller decides
 * whether that is enough.
 */

export interface DrawPage {
  page_number: number;
  eligible: boolean;
}

export interface PagePair {
  fifth: number; // 1..5
  anchor: number; // page_number drawn
  partner: number; // its neighbour
  first: number; // the lower page_number of the two: the pair is read first → second, and the join is between them
  second: number;
}

export const PAIRED_FIFTHS_VERSION = 'paired-fifths-v1';

/** Page types never drawn: blanks, plates and front matter. The #7866 list (confidence-7866/lib.mjs SKIP_TYPES). */
export const PAIRED_SKIP_PAGE_TYPES: readonly string[] = ['blank', 'illustration', 'frontispiece', 'map', 'diagram', 'plate', 'title-page', 'toc', 'dedication', 'preface', 'digitizer-insert', 'archived-spread', 'colophon', 'cover'];

/** FNV-1a 32-bit hash of a string: the seed for a book's draw. */
export function seedOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The partner index of page index i: next if eligible and unused, else previous, else -1. */
export function partnerIndex(pages: DrawPage[], i: number, used: Set<number>): number {
  const ok = (j: number) => j >= 0 && j < pages.length && pages[j].eligible && !used.has(j);
  if (ok(i + 1)) return i + 1;
  if (ok(i - 1)) return i - 1;
  return -1;
}

function pairOf(pages: DrawPage[], fifth: number, a: number, p: number): PagePair {
  const lo = Math.min(a, p), hi = Math.max(a, p);
  return { fifth, anchor: pages[a].page_number, partner: pages[p].page_number, first: pages[lo].page_number, second: pages[hi].page_number };
}

/**
 * The paired-fifths draw. `pages` must hold every page of the book sorted by page_number (eligible or not), because
 * the fifths are cut by position among all pages.
 */
export function pairedFifths(pages: DrawPage[], seedKey: string): PagePair[] {
  const rnd = mulberry32(seedOf(seedKey));
  const used = new Set<number>();
  const pairs: PagePair[] = [];
  for (let k = 0; k < 5; k++) {
    const lo = Math.floor((k * pages.length) / 5), hi = Math.floor(((k + 1) * pages.length) / 5);
    const cand: number[] = [];
    for (let i = lo; i < hi; i++) if (pages[i].eligible && !used.has(i) && partnerIndex(pages, i, used) >= 0) cand.push(i);
    if (!cand.length) continue;
    const a = cand[Math.floor(rnd() * cand.length)];
    const p = partnerIndex(pages, a, used);
    used.add(a); used.add(p);
    pairs.push(pairOf(pages, k + 1, a, p));
  }
  return pairs;
}

/** The pages of a paired draw in reading order: each pair's first then second, pairs in book order. */
export function pairedReadingOrder(pairs: PagePair[]): number[] {
  return [...pairs].sort((x, y) => x.first - y.first).flatMap((p) => [p.first, p.second]);
}
