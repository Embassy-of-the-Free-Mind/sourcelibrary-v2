// PRIOR ART: scripts/audit/translation-page-boundaries.mjs — the LEAK detector (sharedRun, LEAK_MIN_CHARS, the source-repeat
// exemption) this reuses at write time; it reads the corpus mirror after the fact. scripts/lib/block-page-guard.mjs —
// blockAbsorptions/lengthRatioK, the same length rule, but only inside a multi-page call and only FORWARD (n holds n+1).
// scripts/lib/translate-core.mjs assessTranslationHealth — judges one page alone and never sees a neighbour.
/**
 * neighbour-guard — the write-time check that a page's English is not its neighbour's (#5026).
 *
 * The continuity context comes back as page text: page n's English inside page n+1's (Atalanta Fugiens, 21 pairs;
 * L'escole des filles, feedback 6aeff0e1e94c27b5c3c82d3b, 1.5-1.9x the OCR). The page's own health check cannot see
 * it: the copy is good English, at a length well under isExcess's 3x. Two checks, against the STORED English of n-1
 * and n+1 (or the reply's own, when a block is written together):
 *
 *  1. 'neighbour-leak'    the new English shares a run of >= LEAK_MIN_CHARS (sharedRun, editorial blocks and tags
 *                         stripped) with a neighbour's English, the two SOURCES share no such run (a refrain, a
 *                         repeated table), the new page carries more English per source character than that
 *                         neighbour, and the run explains the page's length (see neighbourVerdict). The ratio
 *                         condition says which side holds the copy: re-translating the page the text belongs to,
 *                         beside a neighbour that still holds the leak, is not refused.
 *  2. 'absorbs-neighbour' book-relative length, in both directions: log(en/src) - K above ABSORB_OWN_MIN while the
 *                         English fits src(n)+src(n-1) or src(n)+src(n+1) within ABSORB_TWO_MAX (the #5021 rule,
 *                         leaf-shift.mjs), and the page is ABSORB_OWN_MIN longer than that neighbour's own English.
 *                         K = lengthRatioK over the book's stored text pages; null K = no check.
 *
 * Pure functions here; the doors (translate-core.mjs writePageTranslation and its TS twin) read the neighbours.
 */
import { sharedRun, LEAK_MIN_CHARS } from '../audit/translation-page-boundaries.mjs';
import { lengthRatioK } from './block-page-guard.mjs';
import { ABSORB_OWN_MIN, ABSORB_TWO_MAX, ABSORB_SRC_MIN, ABSORB_SKIP_TYPES } from './leaf-shift.mjs';

export const NEIGHBOUR_LEAK_REASON = 'neighbour-leak';
export const ABSORBS_NEIGHBOUR_REASON = 'absorbs-neighbour';
export { LEAK_MIN_CHARS };

/** The audit's normalisation: editorial blocks and every tag out, whitespace folded. */
export const leakNorm = (t) => String(t || '')
  .replace(/<(meta|summary|keywords|vocab|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const len = (s) => String(s || '').length;

/** A shared run this share of the page's English is the page replaced, not a copy appended: no length test needed. */
export const LEAK_WHOLE_SHARE = 0.3;
/** With no book K to test the length against, a shared run must be at least this share of the page's English. */
export const LEAK_NO_K_SHARE = 0.15;

/** Do two sources repeat each other (a refrain, a table, two near-identical title pages)? Short sources: half the shorter. */
function sourcesRepeat(a, b) {
  const min = Math.min(LEAK_MIN_CHARS, Math.max(40, Math.floor(Math.min(a.length, b.length) / 2)));
  return sharedRun(a, b, min).len >= min;
}

/**
 * The verdict for one page. `page` = { src, en, type }; `prev` / `next` = { src, en } or null; `k` the book's median
 * log(en/src) or null. Returns { refuse: false } or { refuse: true, reason, side: 'prev'|'next', detail }.
 *
 * Sized on 2,992 random pages read by Opus against their sources (scripts/eval/neighbour-guard-5026): the leak test
 * alone refused 31, of which 11 were correct pages (sutra refrains, a repeated table, a page whose copy sat on the
 * neighbour). Two conditions keep the real ones: the run is LEAK_WHOLE_SHARE of the page (the page was replaced), or
 * taking the run out brings the page's length back toward the book's (the copy was appended: own > 0, and
 * |own without the run| < own). The literal absorption rule refused 20 and none held the neighbour's text; a page
 * that absorbs its neighbour stands out from that neighbour, so it must also be ABSORB_OWN_MIN longer than the
 * neighbour's own English is.
 */
export function neighbourVerdict({ page, prev = null, next = null, k = null }) {
  const en = leakNorm(page.en), src = leakNorm(page.src);
  const ratio = (p) => (len(p.src) ? len(p.en) / len(p.src) : Infinity);
  const ownOf = (p) => (k == null || !len(p?.src) || !len(p?.en) ? null : Math.log(len(p.en)) - k - Math.log(len(p.src)));
  const own = ownOf(page);
  for (const [side, nb] of [['prev', prev], ['next', next]]) {
    if (!nb || !len(nb.en)) continue;
    const run = sharedRun(en, leakNorm(nb.en));
    if (run.len < LEAK_MIN_CHARS) continue;
    if (sourcesRepeat(src, leakNorm(nb.src))) continue; // the book repeats itself
    if (!(ratio(page) > ratio(nb))) continue; // the neighbour holds the copy, not this page
    const share = run.len / Math.max(1, en.length);
    let fits;
    if (share >= LEAK_WHOLE_SHARE) fits = true;
    else if (own == null) fits = share >= LEAK_NO_K_SHARE;
    else {
      const without = Math.log(Math.max(1, len(page.en) - run.len)) - k - Math.log(len(page.src));
      fits = own > 0 && Math.abs(without) < own;
    }
    if (!fits) continue;
    return { refuse: true, reason: NEIGHBOUR_LEAK_REASON, side, detail: `shares ${run.len} chars (${Math.round(share * 100)}% of the page) with p.${side}'s English: "${run.text.slice(0, 80)}"` };
  }
  if (own == null || ABSORB_SKIP_TYPES.has(page.type) || len(page.src) < ABSORB_SRC_MIN) return { refuse: false };
  if (own <= ABSORB_OWN_MIN) return { refuse: false };
  for (const [side, nb] of [['prev', prev], ['next', next]]) {
    if (!nb || len(nb.src) < ABSORB_SRC_MIN) continue;
    const nbOwn = ownOf(nb);
    if (nbOwn != null && own - nbOwn <= ABSORB_OWN_MIN) continue; // the neighbourhood runs long, not this page
    const two = Math.log(len(page.en)) - k - Math.log(len(page.src) + len(nb.src));
    if (Math.abs(two) < ABSORB_TWO_MAX) {
      return { refuse: true, reason: ABSORBS_NEIGHBOUR_REASON, side, detail: `log own ${own.toFixed(2)}, with p.${side} ${two.toFixed(2)} (k ${k.toFixed(2)})` };
    }
  }
  return { refuse: false };
}

// The book's K, per process, for a while: a lane writes a book's pages one after another.
const K_TTL_MS = 10 * 60 * 1000;
const kCache = new Map();

/** The book's median log(en/src) over its stored text pages (lengths computed in Mongo), or null. */
export async function bookLengthRatioK(db, bookId, { now = Date.now() } = {}) {
  const hit = kCache.get(bookId);
  if (hit && now - hit.at < K_TTL_MS) return hit.k;
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: bookId, 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' } } },
    { $project: { _id: 0, type: '$page_type', src: { $strLenCP: '$ocr.data' }, en: { $strLenCP: '$translation.data' } } },
  ]).toArray();
  const k = lengthRatioK(rows);
  kCache.set(bookId, { k, at: now });
  if (kCache.size > 500) kCache.delete(kCache.keys().next().value);
  return k;
}

/**
 * The door's check. Reads page n-1 and n+1 (source and stored English) and the book's K; `neighbours` (page_number →
 * English) overrides the stored English, for the reply's own pages when a block is written together. Fail-open: a
 * read that throws returns { refuse: false } (the write itself would fail on a dead db).
 */
export async function checkNeighbours(db, { page, text, ocr, bookId, neighbours = null }) {
  try {
    const n = Number(page?.page_number);
    bookId = bookId || page?.book_id;
    if (!bookId || !Number.isFinite(n)) return { refuse: false };
    const near = await db.collection('pages').find(
      { book_id: bookId, page_number: { $in: [n - 1, n + 1] } },
      { projection: { _id: 0, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }
    ).toArray();
    const side = (m) => {
      const p = near.find((q) => q.page_number === m);
      const en = neighbours && neighbours[m] != null ? neighbours[m] : p?.translation?.data;
      return p || en ? { src: p?.ocr?.data ?? '', en: en ?? '' } : null;
    };
    const k = await bookLengthRatioK(db, bookId);
    return neighbourVerdict({ page: { src: ocr ?? '', en: text, type: page?.page_type ?? null }, prev: side(n - 1), next: side(n + 1), k });
  } catch (e) {
    console.error(`[neighbour-guard] ${page?.id}: ${String(e?.message || e).slice(0, 80)}`);
    return { refuse: false };
  }
}
