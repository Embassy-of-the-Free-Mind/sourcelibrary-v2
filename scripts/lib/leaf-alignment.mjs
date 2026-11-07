// PRIOR ART: scripts/lib/page-integrity.mjs duplicateScan (N vs N+1/N+2 only, word-bigram Dice ≥ 0.9, refuses
// unsegmented scripts) and scripts/audit/page-repeat-images.mjs (image correlation, no text) — neither finds one
// opening's text repeated on pages 2, 8, 12, 14 of a book. scripts/lib/page-alignment.mjs checkAlignment (#3368) dHashes
// the archived image against its source at offset 0 and +1 only, so a 3-leaf shift reads `ambiguous`
// (69af48642a821385be062737, measured 2026-11-01: shown image = source leaf p−3 on every bulk_jp2 page).
// scripts/lib/leaf-offset-match.mjs scores model text against the Archive's own per-leaf text, which abstains on books
// the Archive's engine cannot read (that same incunable: 3 of 248 pages scored). None uses the image BYTES the archiver
// already stored; that is the free signal added here.
/**
 * leaf-alignment — judge-free signals that a page's text and its image are different leaves (#7866).
 * Pure functions over a book's pages in reading order; no I/O.
 *
 * A page row: { p, prose, bodyLen, blank, illus, bytes, w, h, src, type }
 *   p        page_number (> 0)
 *   prose    the OCR's prose (sourceProse: housekeeping tags removed), possibly a prefix
 *   bodyLen  estimated prose length of the WHOLE OCR text (the prose may be a prefix)
 *   bytes    archive_metadata.bytes of the archived image (null when not recorded)
 *   w, h     image_width / image_height (null when not recorded)
 *   src      archive_metadata.source (images archived by one writer share a compression)
 *   illus    the page carries an illustration (an <image-desc>, or a plate/illustration page type)
 *
 * Signals:
 *   repeats       the same text (word 5-gram or, in unsegmented scripts, letter 8-gram shingles) on two pages that
 *                 are not each other's neighbour as a repeat capture would be — the "opening repeated" shape.
 *   inkMismatch   a page whose text is long while its image is a near-blank (bytes per pixel far under the book's
 *                 median for the same writer) — "text on a blank leaf"; and the converse, a page whose text says blank
 *                 on a full image.
 *   offset        the book's text-length sequence against its image-weight sequence at shifts −K…K: on an aligned
 *                 book the two peak at 0 (blank leaves, plates and chapter ends sit on the same pages in both); a
 *                 shifted run peaks at k ≠ 0. Pages are paired by page_number, so a gap in the numbering is a gap.
 *
 * Each returns an explicit unjudged state when it cannot read the book (too few pages with bytes, no variance), so a
 * silent book is never counted as aligned.
 */
import { sourceProse } from './block-drift.mjs';
import { foldWord } from './page-integrity.mjs';

export const SHINGLE_WORDS = 5;
export const SHINGLE_CHARS = 8;
export const MIN_SHINGLES = 15;          // a page needs this many shingles to be compared
export const REPEAT_MIN_CONTAIN = 0.6;   // shared / smaller set
export const INK_LOW = 0.25;             // image bytes-per-pixel under this share of the writer's median = near-blank
export const INK_TEXT_MIN = 300;         // a "full" text: this many prose characters
export const INK_BLANK_HIGH = 0.8;       // a blank-text page on an image at least this share of the median
export const OFFSET_K = 6;
export const OFFSET_MIN_PAIRS = 30;
export const OFFSET_MIN_R = 0.35;        // the best shift's correlation
export const OFFSET_MIN_GAIN = 0.15;     // best shift's r minus r at 0

const FRONT = /cover|title|frontispiece|half-title|wrapper|digitizer|colophon|calibration/i;
const UNSEGMENTED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Tibetan}\p{Script=Thai}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const BLANK_NOTE = /^[\s[(_*-]*(this page is |the page is |page )?(blank|empty|intentionally left blank|no (visible )?text)[^\n]{0,80}$/i;

/** Prose of an OCR text, and whether the OCR says the page is blank. */
export function proseOf(ocr) {
  const prose = sourceProse(ocr);
  const tag = (String(ocr || '').match(/<page-type>\s*([\w-]+)/i) || [])[1]?.toLowerCase() || null;
  const blank = tag === 'blank' || prose.replace(/[\s\-_*#|]/g, '').length < 15 || BLANK_NOTE.test(prose);
  return { prose: blank ? '' : prose, tag, blank };
}

/** 32-bit FNV-1a. */
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }

/** The page's shingle set (hashed). Word 5-grams over folded words; letter 8-grams where the script is unsegmented. */
export function shingles(prose) {
  const t = String(prose || '');
  const out = new Set();
  const unseg = UNSEGMENTED.test(t.slice(0, 600)) && (t.match(/\s/g) || []).length < t.length / 12;
  if (unseg) {
    const letters = t.replace(/[^\p{L}\p{N}]/gu, '');
    for (let i = 0; i + SHINGLE_CHARS <= letters.length; i += 2) out.add(fnv(letters.slice(i, i + SHINGLE_CHARS)));
  } else {
    const w = t.replace(/[-‐‑⸗¬=]\s*\n\s*(?=\p{Ll})/gu, '').split(/\s+/).map(foldWord).map((x) => x.replace(/f/g, 's')).filter((x) => x.length > 0);
    for (let i = 0; i + SHINGLE_WORDS <= w.length; i++) out.add(fnv(w.slice(i, i + SHINGLE_WORDS).join(' ')));
  }
  return out;
}

/**
 * Pairs of pages carrying the same text. Shingles on more than a quarter of the book's comparable pages (running heads,
 * liturgical refrains, formulae) are dropped first. A pair is reported at containment ≥ REPEAT_MIN_CONTAIN.
 * `gap` is the page-number distance: 1 is the repeat-capture shape (the same leaf photographed twice), larger gaps are
 * the misplacement shape. Returns { judged, pages, pairs:[{a,b,gap,contain,shared}] }.
 */
export function repeats(rows) {
  const sets = rows.filter((r) => r.prose).map((r) => ({ p: r.p, s: shingles(r.prose), front: FRONT.test(r.type || '') })).filter((x) => x.s.size >= MIN_SHINGLES);
  if (sets.length < 2) return { judged: false, why: 'too-few-text-pages', pages: sets.length, pairs: [] };
  const df = new Map();
  for (const { s } of sets) for (const h of s) df.set(h, (df.get(h) || 0) + 1);
  const maxDf = Math.max(3, Math.floor(sets.length / 4));
  const index = new Map(); // shingle → page indexes
  const kept = sets.map(({ p, s, front }, i) => {
    const k = [...s].filter((h) => df.get(h) >= 2 && df.get(h) <= maxDf);
    for (const h of k) { let a = index.get(h); if (!a) index.set(h, (a = [])); a.push(i); }
    return { p, n: s.size, k, front };
  });
  const shared = new Map();
  for (const ids of index.values()) {
    if (ids.length > maxDf) continue;
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) { const key = ids[x] * 1e6 + ids[y]; shared.set(key, (shared.get(key) || 0) + 1); }
  }
  const pairs = [];
  for (const [key, c] of shared) {
    const i = Math.floor(key / 1e6), j = key % 1e6, A = kept[i], B = kept[j];
    const contain = c / Math.min(A.n, B.n);
    if (contain >= REPEAT_MIN_CONTAIN && c >= MIN_SHINGLES / 2) pairs.push({ a: A.p, b: B.p, gap: Math.abs(B.p - A.p), contain: +contain.toFixed(3), shared: c, nA: A.n, nB: B.n, front: A.front || B.front });
  }
  pairs.sort((u, v) => u.a - v.a || u.b - v.b);
  return { judged: true, pages: sets.length, pairs };
}

/** Share of a text's non-space characters that are letters. */
export const letterShare = (t) => { const x = String(t || '').replace(/\s+/g, ''); return x.length ? (x.match(/\p{L}/gu) || []).length / x.length : 0; };

/** Image weight of a page: bytes per megapixel when the dimensions are known, else bytes. */
const weight = (r) => (r.bytes > 0 ? (r.w > 0 && r.h > 0 ? r.bytes / (r.w * r.h / 1e6) : r.bytes) : null);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** Per-writer medians of image weight (a book archived by two writers carries two compressions). */
function writerMedians(rows) {
  const g = new Map();
  for (const r of rows) { const x = weight(r); if (x == null) continue; const k = `${r.src || '?'}|${r.w > 0 ? 'px' : 'b'}`; if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
  const m = new Map();
  for (const [k, xs] of g) if (xs.length >= 8) m.set(k, median(xs));
  return m;
}

/**
 * Text on a near-blank image, and blank text on a full image. Returns { judged, pages, textOnBlank:[…], blankOnInk:[…] }.
 * `ratio` is the page's image weight over its writer's median.
 */
export function inkMismatch(rows) {
  const med = writerMedians(rows);
  if (!med.size) return { judged: false, why: 'no-image-bytes', pages: 0, textOnBlank: [], blankOnInk: [] };
  const textOnBlank = [], blankOnInk = [];
  let pages = 0;
  for (const r of rows) {
    const x = weight(r); const m = med.get(`${r.src || '?'}|${r.w > 0 ? 'px' : 'b'}`);
    if (x == null || !m) continue;
    pages++;
    const ratio = +(x / m).toFixed(3);
    // Words, not scanner noise: OCR of a tissue or blank leaf ("‘ 4 ‘ « bes -— « rr. irk") is junk, not another leaf's text.
    if (r.bodyLen >= INK_TEXT_MIN && ratio < INK_LOW && letterShare(r.prose) >= 0.7) textOnBlank.push({ p: r.p, ratio, bodyLen: r.bodyLen });
    if (r.blank && ratio >= INK_BLANK_HIGH && !/plate|illustration|image|map|figure|photograph|cover/i.test(r.type || '')) blankOnInk.push({ p: r.p, ratio });
  }
  return { judged: pages >= 8, pages, textOnBlank, blankOnInk };
}

function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n; let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; }
  return b > 0 && c > 0 ? a / Math.sqrt(b * c) : null;
}

/**
 * Correlation of text length at page p with image weight at page p+k, k = −K…K, over the given rows.
 * Returns { judged, n, r:{k:r}, best, rBest, r0, gain }. `best` ≠ 0 with rBest ≥ OFFSET_MIN_R and gain ≥ OFFSET_MIN_GAIN
 * is a shift: the image a text belongs to sits k pages after it.
 */
export function offsetScan(rows, { K = OFFSET_K } = {}) {
  // A picture is heavy whatever its caption says, and books alternate plate and description (a herbal: plant, then
  // its text), which correlates text at p with image at p−1 on an aligned book. Pages with an illustration are left
  // out of both sequences.
  const plain = rows.filter((r) => !r.illus);
  const img = new Map();
  for (const r of plain) { const x = weight(r); if (x != null) img.set(r.p, Math.log(x)); }
  const txt = new Map(plain.map((r) => [r.p, Math.log1p(r.blank ? 0 : r.bodyLen || 0)]));
  const r = {}; let n0 = 0;
  for (let k = -K; k <= K; k++) {
    const xs = [], ys = [];
    for (const [p, y] of txt) { const x = img.get(p + k); if (x != null) { xs.push(x); ys.push(y); } }
    if (k === 0) n0 = xs.length;
    r[k] = xs.length >= OFFSET_MIN_PAIRS ? pearson(xs, ys) : null;
  }
  if (n0 < OFFSET_MIN_PAIRS || r[0] == null) return { judged: false, why: 'too-few-pairs', n: n0, r };
  let best = 0;
  for (let k = -K; k <= K; k++) if (r[k] != null && r[k] > r[best]) best = k;
  const gain = +(r[best] - r[0]).toFixed(3);
  return { judged: true, n: n0, r: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? null : +v.toFixed(3)])), best, rBest: +r[best].toFixed(3), r0: +r[0].toFixed(3), gain, shifted: best !== 0 && r[best] >= OFFSET_MIN_R && gain >= OFFSET_MIN_GAIN };
}

/** offsetScan per image writer (a shift is a property of one writer's run: bulk_jp2 pages beside per-page IIIF ones). */
export function offsetByWriter(rows) {
  const groups = new Map();
  for (const r of rows) { const k = r.src || '?'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const out = {};
  for (const [k, g] of groups) if (g.length >= OFFSET_MIN_PAIRS) {
    // The text side is the whole book (a text at p may belong to an image of another writer's run at p+k);
    // the image side is this writer's pages only.
    const own = new Set(g.map((r) => r.p));
    out[k] = offsetScan(rows.map((r) => (own.has(r.p) ? r : { ...r, bytes: null })));
  }
  return out;
}

/**
 * One book's verdict. Score (for ranking only, not a probability): a shifted offset run outweighs everything;
 * text on blank images and long-gap repeats add per page.
 */
export function bookSignals(rows) {
  const rep = repeats(rows), ink = inkMismatch(rows), off = offsetScan(rows), byWriter = offsetByWriter(rows);
  const far = rep.pairs.filter((x) => x.gap >= 2);
  const shiftedWriters = Object.entries(byWriter).filter(([, v]) => v.judged && v.shifted).map(([k, v]) => ({ writer: k, best: v.best, rBest: v.rBest, r0: v.r0, gain: v.gain, n: v.n }));
  const offShift = off.judged && off.shifted;
  const farPages = new Set(far.flatMap((x) => [x.a, x.b]));
  const score = (offShift ? 10 + 10 * off.gain : 0) + (shiftedWriters.length && !offShift ? 6 + 10 * Math.max(...shiftedWriters.map((w) => w.gain)) : 0)
    + 2 * Math.min(ink.textOnBlank.length, 10) + 0.5 * Math.min(ink.blankOnInk.length, 10) + 1.5 * Math.min(farPages.size, 10);
  return {
    score: +score.toFixed(2),
    offset: off.judged ? { best: off.best, rBest: off.rBest, r0: off.r0, gain: off.gain, n: off.n, shifted: off.shifted } : { judged: false, n: off.n },
    shiftedWriters,
    textOnBlank: ink.textOnBlank, blankOnInk: ink.blankOnInk, inkJudged: ink.judged,
    repeatsFar: far, repeatsNear: rep.pairs.filter((x) => x.gap === 1).length, repeatJudged: rep.judged,
  };
}

/** A repeat pair strong enough to confirm: the whole text twice (containment ≥ 0.9 at sizes within 0.8 of each other,
 *  ≥ 50 shingles), no cover/title/frontispiece in the pair, and the two shown images different (dHash ≥ 20). Set on
 *  2026-11-01 from the pairs of the two validation sets: every pair in a book read wrong-leaf by eye passes it or its
 *  book is confirmed otherwise; every pair opened by eye that was NOT a misplacement (a printed wrapper repeating the
 *  title page, a leaf re-shot inside a spread, a leaf re-shot under a calibration card) fails it. */
export const REPEAT_CONFIRM = { contain: 0.9, ratio: 0.8, minShingles: 50, dist: 20 };
export function strongRepeat(pair, dist) {
  const lo = Math.min(pair.nA ?? 0, pair.nB ?? 0), hi = Math.max(pair.nA ?? 0, pair.nB ?? 0);
  return pair.contain >= REPEAT_CONFIRM.contain && hi > 0 && lo / hi >= REPEAT_CONFIRM.ratio && lo >= REPEAT_CONFIRM.minShingles && !pair.front && dist >= REPEAT_CONFIRM.dist;
}

/**
 * A book's arbitrated verdict (validated 2026-11-01 on 43 wrong-leaf books read by eye on #5803 and 8 read right, and on
 * the 160 books Opus judged on #7866): CONFIRMED when the image arbiter places the shown image off its source leaf
 * (k ≠ 0, not necessarily the same k) on at least two of three sampled pages, or a text sits on an image with under 0.5% ink, or the whole of one
 * text sits on two different images (strongRepeat). One off page alone is not enough (two of the eight right books
 * show one). `a` is the arbitrate row, `r` the scan row (its repeat pairs carry the sizes).
 */
/** Sampled pages whose shown image is a numbered leaf other than its own. A #3368 shift grows at every interior
 *  excluded leaf (69e53425…: −6 at p.282, −4 at p.106), so two off pages need not agree on k. */
export const imageOff = (a) => (a?.offset || []).filter((o) => typeof o.k === 'number' && o.k !== 0);

export function confirmed(a, r) {
  if (!a) return null;
  const why = [];
  const off = imageOff(a);
  if (off.length >= 2) why.push(`image ${[...new Set(off.map((o) => (o.k > 0 ? `+${o.k}` : `${o.k}`)))].join('/')} leaves off its source (dHash, ${off.length}/${a.offset.length} pages)`);
  if (a.blankConfirmed.length) why.push(`text on a blank leaf (ink < 0.5%): p. ${a.blankConfirmed.join(', ')}`);
  const strong = (a.repeat || []).filter((x) => x.dist != null && strongRepeat((r?.repeatsFar || []).find((y) => y.a === x.a && y.b === x.b) || x, x.dist));
  if (strong.length) why.push(`one text on two different leaves: ${strong.map((x) => `${x.a}=${x.b}`).join(', ')}`);
  return why.length ? why : null;
}
