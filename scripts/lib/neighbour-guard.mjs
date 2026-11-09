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
import { lengthRatioK } from './block-page-guard.mjs';
import { stripMarkupTags } from './strip-markup-tags.mjs';
import { ABSORB_OWN_MIN, ABSORB_TWO_MAX, ABSORB_SRC_MIN, ABSORB_SKIP_TYPES, windowLang } from './leaf-shift.mjs';

export const NEIGHBOUR_LEAK_REASON = 'neighbour-leak';
export const ABSORBS_NEIGHBOUR_REASON = 'absorbs-neighbour';
/** The audit's floor (scripts/audit/translation-page-boundaries.mjs, which imports it from here). */
export const LEAK_MIN_CHARS = 200;

/** Longest run a and b share, found through 40-char shingles of b then extended (dupscan). */
export function sharedRun(a, b, min = LEAK_MIN_CHARS) {
  if (a.length < min || b.length < min) return { len: 0, text: '' };
  const K = 40, idx = new Map();
  for (let i = 0; i + K <= b.length; i += 8) { const s = b.slice(i, i + K); if (!idx.has(s)) idx.set(s, i); }
  let best = 0, bestA = -1;
  for (let i = 0; i + K <= a.length; i++) {
    const j = idx.get(a.slice(i, i + K)); if (j == null) continue;
    let back = 0; while (i - back > 0 && j - back > 0 && a[i - back - 1] === b[j - back - 1]) back++;
    let L = K; while (i + L < a.length && j + L < b.length && a[i + L] === b[j + L]) L++;
    if (L + back > best) { best = L + back; bestA = i - back; }
    i += Math.max(0, L - K); // skip what this match already covered
  }
  return { len: best, text: bestA >= 0 ? a.slice(bestA, bestA + Math.min(best, 200)) : '' };
}

/** The audit's normalisation: editorial blocks and every tag out (stripMarkupTags, so a `<-` centring marker does not
 *  eat the text after it, #5564), whitespace folded. */
export const leakNorm = (t) => stripMarkupTags(String(t || '')
  .replace(/<(meta|summary|keywords|vocab|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')).replace(/\s+/g, ' ').trim();

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
 *
 * @param {any} db
 * @param {{ page: any, text: string, ocr?: string | null, bookId?: string | null, neighbours?: Record<number, string> | null }} args
 * @returns {Promise<{ refuse: false } | { refuse: true, reason: string, side: 'prev' | 'next', detail: string }>}
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

// ── the opening echo: a sentence of n-1's English at the head of n (#8399) ────────────────────────────────────────────

/**
 * Words of page n's English read for the echo test, the word-shingle size, and the share of those shingles that must
 * appear in page n-1's English. Sized on live agy4-lane output, 2026-11-08 (6,195 pages, 30 h): 77 pages at >= 0.3,
 * 72 of them in the reader-visible text; at call boundaries the rate was 3.0% against 0.7% inside a call.
 */
export const ECHO_HEAD_WORDS = 40;
export const ECHO_SHINGLE = 6;
export const ECHO_MIN_SHARE = 0.3;

const echoWords = (t) => leakNorm(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
function shingles(words, k) {
  const s = new Set();
  for (let i = 0; i + k <= words.length; i++) s.add(words.slice(i, i + k).join(' '));
  return s;
}
const shareIn = (a, b) => { if (!a.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / a.size; };

/**
 * Does page n's English open with words already on page n-1's? The repeat sharedRun cannot see: one sentence
 * (~250 chars) on a long page, under LEAK_MIN_CHARS and too small to explain the page's length, so neighbourVerdict
 * passes it. Reads only what a reader sees (leakNorm drops <meta>, <summary>, <keywords> and every tag).
 *
 * `share`: the fraction of page n's opening ECHO_SHINGLE-word shingles (its first ECHO_HEAD_WORDS words) found
 * anywhere in n-1's English. `echo`: share >= ECHO_MIN_SHARE and the SOURCES do not repeat the same way (n's OCR
 * opening against n-1's OCR, same test; a book that repeats itself is not a defect). `sourceRepeats` is null when
 * either OCR is missing. It does not say WHICH page holds the extra text: at a call boundary it is usually n
 * (copying the seed it was given), inside a call it can be either; a judge with both scans decides.
 *
 * Not an echo, either: `parallel` (n and n-1 transcribe different languages, a facing-page edition) or
 * `sourceRepeats` (the sources open the same way). The English is always space-separated, so `share` is defined
 * for every book; the source test is not (no spaces in Chinese or Tibetan OCR), and then `sourceRepeats` is null and
 * a refrain in those books can still read as an echo. A judge decides those.
 */
export function openingEcho({ tr, prevTr, ocr = null, prevOcr = null }) {
  const share = shareIn(shingles(echoWords(tr).slice(0, ECHO_HEAD_WORDS), ECHO_SHINGLE), shingles(echoWords(prevTr), ECHO_SHINGLE));
  // The source side: null (unknown) when either OCR is missing or yields no shingles (a script without spaces), so a
  // Chinese or Tibetan refrain is never read as "the sources differ".
  const head = ocr ? shingles(echoWords(ocr).slice(0, ECHO_HEAD_WORDS), ECHO_SHINGLE) : null;
  const prevSh = prevOcr ? shingles(echoWords(prevOcr), ECHO_SHINGLE) : null;
  const sourceShare = head?.size && prevSh?.size ? shareIn(head, prevSh) : null;
  const sourceRepeats = sourceShare == null ? null : sourceShare >= ECHO_MIN_SHARE;
  // A facing-page edition (Loeb Latin/English, Kühn's Galen) prints a passage and its translation on neighbouring
  // pages, so their English agrees by design: the leaf-shift screen's cross-language rule (windowLang, #5021 gate 1).
  const langs = ocr && prevOcr ? [windowLang(ocr), windowLang(prevOcr)] : [null, null];
  const parallel = !!langs[0] && !!langs[1] && langs[0] !== langs[1];
  return { share: +share.toFixed(3), sourceShare: sourceShare == null ? null : +sourceShare.toFixed(3), sourceRepeats, parallel, echo: share >= ECHO_MIN_SHARE && sourceRepeats !== true && !parallel };
}
