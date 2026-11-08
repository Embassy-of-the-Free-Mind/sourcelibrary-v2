/**
 * PRIOR ART: src/lib/paired-fifths.ts — the same rule for the app (the volunteer shift); this is its copy for scripts,
 * which cannot import TypeScript. src/lib/__tests__/paired-fifths.test.ts pins the two equal on the same inputs.
 * scripts/eval/confidence-7866/frame.mjs draw() is the one-page-per-fifth frame this extends.
 *
 * The paired-fifths draw (#8405): 10 pages of a book, two adjacent pages from each fifth. Read the header of
 * src/lib/paired-fifths.ts for the rule and why. Extra here: pairsFromAnchors(), which pairs pages already drawn
 * (the #7866 anchors) with the same partner rule, so an old 5-page read becomes a paired read by judging 5 pages more.
 */

export const PAIRED_FIFTHS_VERSION = 'paired-fifths-v1';

export function seedOf(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function partnerIndex(pages, i, used) {
  const ok = (j) => j >= 0 && j < pages.length && pages[j].eligible && !used.has(j);
  if (ok(i + 1)) return i + 1;
  if (ok(i - 1)) return i - 1;
  return -1;
}

function pairOf(pages, fifth, a, p) {
  const lo = Math.min(a, p), hi = Math.max(a, p);
  return { fifth, anchor: pages[a].page_number, partner: pages[p].page_number, first: pages[lo].page_number, second: pages[hi].page_number };
}

/** pages: every page of the book sorted by page_number, each { page_number, eligible }. */
export function pairedFifths(pages, seedKey) {
  const rnd = mulberry32(seedOf(seedKey));
  const used = new Set();
  const pairs = [];
  for (let k = 0; k < 5; k++) {
    const lo = Math.floor((k * pages.length) / 5), hi = Math.floor(((k + 1) * pages.length) / 5);
    const cand = [];
    for (let i = lo; i < hi; i++) if (pages[i].eligible && !used.has(i) && partnerIndex(pages, i, used) >= 0) cand.push(i);
    if (!cand.length) continue;
    const a = cand[Math.floor(rnd() * cand.length)];
    const p = partnerIndex(pages, a, used);
    used.add(a); used.add(p);
    pairs.push(pairOf(pages, k + 1, a, p));
  }
  return pairs;
}

/**
 * Pair anchors that were drawn already (page_numbers, one per fifth, in order). An anchor with no eligible unused
 * neighbour yields { fifth, anchor, partner: null }: it stays a single page, and the caller counts it.
 */
export function pairsFromAnchors(pages, anchors) {
  const idx = new Map(pages.map((p, i) => [p.page_number, i]));
  const used = new Set(anchors.map((a) => idx.get(a)).filter((i) => i != null));
  return anchors.map((a, k) => {
    const i = idx.get(a);
    if (i == null) return { fifth: k + 1, anchor: a, partner: null, first: a, second: null };
    const p = partnerIndex(pages, i, used);
    if (p < 0) return { fifth: k + 1, anchor: a, partner: null, first: a, second: null };
    used.add(p);
    return pairOf(pages, k + 1, i, p);
  });
}

export function pairedReadingOrder(pairs) {
  return [...pairs].sort((x, y) => x.first - y.first).flatMap((p) => (p.second == null ? [p.first] : [p.first, p.second]));
}
