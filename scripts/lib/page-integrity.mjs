// PRIOR ART: scripts/lib/block-drift.mjs (sourceProse/translationProse are reused here; it
// judges where a translation put a clause, never whether the SCANS are in order);
// scripts/audit/translation-page-boundaries.mjs (the mirror-walk skeleton and sharedRun, which
// compares NEIGHBOURING translations, not a translation with its own source);
// scripts/maintenance/detect-translation-collapse.mjs (repetition collapse inside one
// translation, not truncation against the source length); scripts/lib/page-alignment.mjs (dHash
// of page images for OCR↔image alignment — needs the image bytes, which the mirror does not
// hold). Nothing in scripts/audit/ or scripts/lib/ reads <page-num> or the catchword.
/**
 * page-integrity — exact checks over text we already store (local mirror, no model).
 *
 * The OCR prompt (v4.2026-02 on) tags every page with the PRINTED page number (<page-num>),
 * the catchword (<meta>catchword: …</meta>), running head and signature. An early printed book
 * is a chain: each page's catchword is the first word of the next page, and the printed
 * numbers climb by one per scan. Where the chain breaks, a leaf is missing, doubled or out of
 * order in the SCAN — the translation reads smoothly across it and no health gate sees it.
 *
 *   1. catchwordBoundary()  — does page N+1 open with page N's catchword?
 *   2. pageNumberBreaks()   — is the printed number sequence monotone at the book's rate?
 *      fitPrintedPages()    — the same fit, read the other way: which printed page is each scan?
 *   3. duplicateScan()      — is OCR N+1 (nearly) the same text as OCR N?
 *   4. truncationRatio()    — is the translation far shorter than its source?
 *   5. echoedSource()       — does the "translation" contain the source verbatim?
 *   (6–7, the page-error taxonomy checks, are listed at their section below)
 *   8. metaPayload()        — is page text hidden inside the continuity <meta>?
 *
 * Every detector returns an explicit UNJUDGEABLE state (null / { judged: false, why }) for an
 * input it cannot read — a caseless or CJK "catchword" that is really the fore-edge title, a
 * page with no number, a source too short to compare — so that silence is never counted as
 * a clean page (non-latin-text-operations.md).
 */
import { sourceProse, translationProse } from './block-drift.mjs';

export { sourceProse, translationProse };

// Each page is read by several checks and by its neighbours' checks (N-1, N+1, N+2); the
// derived forms are memoised per text. The cache empties itself so a walk cannot grow it.
const memo = new Map();
const cached = (tag, fn) => (x, ...rest) => {
  const k = tag + (rest.length ? JSON.stringify(rest) : '') + '\u0000' + x;
  let v = memo.get(k);
  if (v === undefined) { if (memo.size > 50000) memo.clear(); v = fn(x, ...rest); memo.set(k, v); }
  return v;
};
const proseOf = cached('s', sourceProse);
const trProseOf = cached('t', translationProse);

// ── folding ────────────────────────────────────────────────────────────────────────────────

/** Compare-fold for early-modern print: case, diacritics, ſ, u/v, i/j, æ/œ, ß. Letters only
 *  survive; non-Latin letters (Greek, Hebrew, Cyrillic, Arabic) are kept, marks stripped. */
export function foldWord(w) {
  return String(w || '')
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ſ/g, 's').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
    .replace(/v/g, 'u').replace(/j/g, 'i').replace(/w/g, 'uu')
    .replace(/[^\p{L}]/gu, '');
}

const HAN_OR_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CASELESS_UNSEGMENTED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Tibetan}\p{Script=Thai}\p{Script=Devanagari}]/u;

const words = (text) => String(text || '').split(/\s+/).map(foldWord).filter(Boolean);

// ── 1. catchwords ──────────────────────────────────────────────────────────────────────────

/**
 * The catchword recorded on a page, or null. Reads `catchword: X` (also "catchwords", "catchword
 * at bottom", "catchword in gutter") inside <meta>, and a bare <catchword> tag. Returns the
 * printed form and its folded tokens; `partial` when the catchword ends in a hyphen (the printer
 * set the first syllable only, e.g. "Deli-").
 *
 * UNJUDGEABLE (returns { judged:false }): a Han/kana value — in East-Asian books the model puts
 * the fore-edge title (版心) under this key, which is not a catchword; and a value with no
 * letters after folding.
 */
export function parseCatchword(ocr) {
  const o = String(ocr || '');
  let raw = null;
  const tag = o.match(/<catchword>([\s\S]*?)<\/catchword>/i);
  if (tag) raw = tag[1];
  if (raw == null) {
    for (const m of o.matchAll(/<meta>([\s\S]*?)<\/meta>/gi)) {
      const c = m[1].match(/catch-?words?(?:\s+(?:at|in|on)\s+[a-z ]{2,20}?)?\s*[:=]\s*([^;|\n]+)/i);
      if (c) { raw = c[1]; break; }
    }
  }
  if (raw == null) return null;
  let v = raw.trim().replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '').trim();
  // A description rather than a value ("none", "illegible", "present but cut off").
  if (/^(none|n\/a|illegible|unclear|not visible|absent|cut off|\[?illegible\]?)\b/i.test(v)) return { judged: false, why: 'described' };
  if (HAN_OR_KANA.test(v)) return { judged: false, why: 'cjk-fore-edge' };
  // Keep at most the first three printed tokens; a model sometimes runs on into a description.
  const printed = v.split(/\s+/).slice(0, 3);
  const partial = /[-‐‑⸗=¬]$/.test(printed[printed.length - 1] || '');
  const tokens = printed.map(foldWord).filter(Boolean);
  if (!tokens.length) return { judged: false, why: 'no-letters' };
  return { judged: true, printed: printed.join(' '), tokens, partial };
}

/**
 * The first `n` folded words a reader meets on a page: running head and section heading
 * INCLUDED (a catchword may be the next heading — "CAP." — or the next body word), the model's
 * housekeeping (language, page type, page number, signature, meta, vocab, image description)
 * excluded. Markdown heading marks are dropped.
 */
function openingWordsRaw(ocr, n, withHeader) {
  const drop = 'meta|vocab|language|lang|page-type|page-num|sig|scan-quality|script|image-desc|detected-images|warning|columns|folio|split-position' + (withHeader ? '' : '|header');
  const text = String(ocr || '')
    .replace(new RegExp(`<(${drop})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/->|<-/g, ' ')
    .replace(/[#*_>`~|]/g, ' ');
  return joinSpacedLetters(words(text)).slice(0, n);
}

/** Letter-spaced headings ("C A P. I", "S E C T I O") come back as one-letter tokens; three or
 *  more in a row are one word. */
export function joinSpacedLetters(ws) {
  const out = [];
  for (let k = 0; k < ws.length;) {
    if (ws[k].length === 1) {
      let j = k; while (j < ws.length && ws[j].length === 1) j++;
      if (j - k >= 3) { out.push(ws.slice(k, j).join('')); k = j; continue; }
    }
    out.push(ws[k]); k++;
  }
  return out;
}
const openingCached = cached('o', openingWordsRaw);
export function openingWords(ocr, n = 15, { withHeader = true } = {}) { return openingCached(ocr, n, withHeader); }

/** Does folded token `c` (catchword) match folded token `w` (page word)? Prefix either way,
 *  so a partial catchword "deli" matches "delicias" and a catchword that the OCR read whole
 *  matches a hyphen-broken first word. The shorter side must be ≥ 2 letters (a one-letter
 *  catchword like "A" is too weak to judge and is handled by the caller). */
export function tokenMatches(c, w) {
  if (!c || !w) return false;
  // Long s is read as f in both the catchword and the body ("fic"/"sic", "Suge"/"fuge").
  c = c.replace(/f/g, 's'); w = w.replace(/f/g, 's');
  const [s, l] = c.length <= w.length ? [c, w] : [w, c];
  if (s.length < 2) return c === w;
  if (l.startsWith(s)) return true;
  // One misread letter in a word of four or more ("Scin"/"sein", "Sehe"/"gehe" in Fraktur).
  if (s.length < 4) return false;
  let diff = 0;
  for (let k = 0; k < s.length && diff <= 1; k++) if (s[k] !== l[k]) diff++;
  return diff <= 1;
}

/** Where a SHORT catchword ("IN", "de") may sit: these words occur anywhere, so only the first
 *  few words of the next page count. */
export const SHORT_CATCHWORD_REACH = 3;

/** Index in `win` where the catchword starts, or -1. The first token decides; the rest of a
 *  multi-word value is often the model running on into a description ("HER-, Stamp: B.R"). */
export function findCatchword(tokens, win) {
  const reach = tokens[0].length <= 2 ? Math.min(win.length, SHORT_CATCHWORD_REACH) : win.length;
  for (let j = 0; j < reach; j++) if (tokenMatches(tokens[0], win[j])) return j;
  return -1;
}

export const CATCHWORD_WINDOW = 12;

/** First language the OCR's own <language> tag names, lower-cased, or null. */
const pageLang = (ocr) => (String(ocr || '').match(/<(?:language|lang)>\s*([^<,;/(]+)/i)?.[1] || '').trim().toLowerCase() || null;

/** Does a page open with the catchword? Tried with the running head/heading and without it, so
 *  a short catchword ("So", "IN") under a heading ("FUGA XIX. in infra") still counts. */
export function opensWith(tokens, ocr) {
  const a = findCatchword(tokens, openingWords(ocr, CATCHWORD_WINDOW));
  if (a >= 0) return a;
  return findCatchword(tokens, openingWords(ocr, CATCHWORD_WINDOW, { withHeader: false }));
}

/**
 * Judge one boundary. `pages` is the book's rows in scan order ({p, ocr, type}); `i` indexes
 * page N. Returns null when page N has no catchword, else
 *   { judged:false, why }                        — cannot judge (CJK, one-letter, no next page)
 *   { judged:true, ok:true, at }                 — N+1 opens with the catchword (at = word index)
 *   { judged:true, ok:false, shape, ... }        — the chain breaks; shape is
 *       'plate-between'   N+1 is a non-text leaf (plate, blank) and N+2 opens with it — legit
 *       'facing-text'     N+1 is in another language and N+2 opens with it — a parallel-text
 *                         edition, legit
 *       'skip'            N+1 does not, N+2 does, and N+1 is text — an inserted/duplicated leaf
 *                         or a leaf scanned out of order
 *       'back'            N-1 opened with it — reversed leaves
 *       'mid-page'        it occurs later on N+1 (not in the opening window) — OCR head
 *                         truncation or a reordered head, not a missing leaf
 *       'repeat'          N+1 carries the SAME catchword as N — a duplicate scan
 *       'absent'          nowhere nearby — a missing leaf, or an OCR misread of either word
 */
export function catchwordBoundary(pages, i, { nonText = NON_TEXT_TYPES } = {}) {
  const A = pages[i];
  const cw = parseCatchword(A.ocr);
  if (cw == null) return null;
  if (!cw.judged) return { judged: false, why: cw.why };
  if (cw.tokens[0].length < 2) return { judged: false, why: 'one-letter' };
  const B = pages[i + 1];
  if (!B || B.p !== A.p + 1) return { judged: false, why: 'no-next-page' };
  // The model often records the page's own LAST WORD as the catchword — books that print none
  // (most after 1800) get one anyway. Such a value says nothing about the next page unless the
  // next page happens to open with it.
  const tail = words(proseOf(A.ocr).split(/\s+/).slice(-4).join(' '));
  const copiedTail = tail.slice(-3).some(w => w === cw.tokens[0]);
  if (!B.ocr || !B.ocr.trim()) return { judged: false, why: 'next-no-ocr' };
  const winB = openingWords(B.ocr, CATCHWORD_WINDOW);
  if (!winB.length) return { judged: false, why: 'next-empty' };
  const at = opensWith(cw.tokens, B.ocr);
  if (at >= 0) return { judged: true, ok: true, at, catchword: cw.printed };
  // The model often tags the page's LAST LINE as the catchword when it ends in a broken word
  // ("Tho-" … next page "ma erant"): the rest of the word opening N+1 in lowercase is the
  // same continuity evidence a catchword gives.
  if (cw.partial) {
    const firstBody = proseOf(B.ocr).replace(/^[^\p{L}]+/u, '');
    if (/^\p{Ll}/u.test(firstBody)) return { judged: true, ok: true, at: 'carry', catchword: cw.printed };
  }

  if (copiedTail) return { judged: false, why: 'last-word-of-page' };
  const base = { judged: true, ok: false, catchword: cw.printed, nextOpens: winB.slice(0, 6).join(' ') };
  const cwB = parseCatchword(B.ocr);
  if (cwB?.judged && cwB.tokens.join(' ') === cw.tokens.join(' ')) return { ...base, shape: 'repeat' };
  const C = pages[i + 2];
  if (C && C.p === A.p + 2 && C.ocr && opensWith(cw.tokens, C.ocr) >= 0) {
    const bText = proseOf(B.ocr).length;
    if (nonText.has(B.type) || bText < 80) return { ...base, shape: 'plate-between' };
    // A facing-page edition (Loeb: Greek/Latin left, English right) chains every OTHER page.
    const la = pageLang(A.ocr), lb = pageLang(B.ocr);
    if (la && lb && la !== lb) return { ...base, shape: 'facing-text' };
    return { ...base, shape: 'skip' };
  }
  const Z = pages[i - 1];
  if (Z && Z.p === A.p - 1 && Z.ocr && opensWith(cw.tokens, Z.ocr) >= 0) return { ...base, shape: 'back' };
  if (findCatchword(cw.tokens, words(proseOf(B.ocr)).slice(CATCHWORD_WINDOW, 200)) >= 0) return { ...base, shape: 'mid-page' };
  return { ...base, shape: 'absent' };
}

export const NON_TEXT_TYPES = new Set(['illustration', 'blank', 'plate', 'frontispiece', 'map', 'diagram',
  'front-cover', 'back-cover', 'cover', 'endpaper', 'spine', 'digitizer-insert', 'digitizer-notice',
  'exlibris', 'bookplate', 'color-chart', 'archived-spread']);

// ── 2. printed page numbers ────────────────────────────────────────────────────────────────

const ROMAN = /^(?=[mdclxvi])m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const ROMAN_VAL = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function romanValue(s) {
  const t = s.toLowerCase(); let v = 0;
  for (let k = 0; k < t.length; k++) { const a = ROMAN_VAL[t[k]], b = ROMAN_VAL[t[k + 1]] || 0; v += a < b ? -a : a; }
  return v;
}
// Native digit blocks → ASCII (Devanagari, Bengali, Arabic-Indic, Persian, Tibetan, Thai …).
const DIGIT_ZEROS = [0x0660, 0x06F0, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66, 0x0E50, 0x0ED0, 0x0F20, 0x1040, 0xFF10];
function asciiDigits(s) {
  return s.replace(/[٠-٩۰-۹०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯๐-๙໐-໙༠-༩၀-၉０-９]/g,
    ch => { const c = ch.charCodeAt(0); for (const z of DIGIT_ZEROS) if (c >= z && c <= z + 9) return String(c - z); return ch; });
}

/**
 * The printed number on a page, parsed. Returns null when the page has no <page-num> tag, else
 *   { kind:'arabic'|'roman'|'folio', value, span } or { kind:'other', raw }.
 * 'folio' is a manuscript/foliated leaf number with a side ("12r", "fol. 12v"): value counts
 * SIDES (2n for recto, 2n+1 for verso) so that it climbs by one per scan like a page number.
 * A range "561-562" (a two-page spread scanned as one image) has span 2. Hebrew/Greek letter
 * numerals, CJK numerals and anything else come back as 'other' — unjudged, not a break.
 */
export function parsePageNum(ocr) {
  const m = String(ocr || '').match(/<page-num>([\s\S]*?)<\/page-num>/i);
  if (!m) return null;
  let raw = asciiDigits(m[1].trim()).replace(/^[\[(]\s*|\s*[\])]$/g, '').replace(/[.,:;]+$/, '').trim();
  if (!raw) return { kind: 'other', raw: '' };
  let f = raw.match(/^(?:fol(?:io)?\.?|f\.?|ff\.?)?\s*(\d{1,4})\s*([rv])(?:ecto|erso)?$/i);
  if (f) return { kind: 'folio', value: 2 * Number(f[1]) + (f[2].toLowerCase() === 'v' ? 1 : 0), span: 1 };
  f = raw.match(/^(?:p\.|pag\.|page|s\.|fol\.?|f\.)?\s*(\d{1,4})$/i);
  if (f) return { kind: 'arabic', value: Number(f[1]), span: 1 };
  f = raw.match(/^(\d{1,4})\s*[-–—/,]\s*(\d{1,4})$/);
  if (f && Number(f[2]) === Number(f[1]) + 1) return { kind: 'arabic', value: Number(f[1]), span: 2 };
  if (ROMAN.test(raw)) return { kind: 'roman', value: romanValue(raw), span: 1 };
  return { kind: 'other', raw: raw.slice(0, 30) };
}

/**
 * Page-number breaks in one book. `pages` = rows in scan order with {p, ocr, type}.
 *
 * Method, per numbering kind (arabic / roman / folio, each its own sequence):
 *   - rate: median printed Δ per scan Δ over adjacent numbered pairs (1 = paginated, 0.5 = only
 *     rectos numbered, 2 = spreads). A book whose rate is none of these is 'irregular' (unjudged).
 *   - outliers: a run of ≤ MAX_OUTLIER_RUN numbers off the line that its neighbours share
 *     (…, 111, 118, 18, 114, …) is a misprint or OCR misread, not a leaf problem — dropped,
 *     counted apart.
 *   - breaks: remaining adjacent numbered pairs whose printed Δ ≠ rate × scan Δ, classed
 *       'jump'     printed number advances more than the scans do (d>0; d=2 at rate 1 = one leaf)
 *       'repeat'   the same number twice (a duplicated scan, or a double-printed number)
 *       'back'     the number goes down but not to a restart
 *       'restart'  it drops to ≤ 3 — a new part/volume with its own pagination (legit)
 *       'extra'    more scans than numbers (unnumbered plates/blank leaves between) — the
 *                  intervening pages' types are returned so the caller can tell a plate from text
 * Pairs more than MAX_SCAN_GAP scans apart are not judged (too little evidence of what's between).
 * A sequence whose adjacent pairs fit the rate less than MIN_FIT_SHARE of the time is not a
 * pagination (section numbers, plate numbers, two interleaved counters) — 'irregular', unjudged.
 */
export const MAX_SCAN_GAP = 4;
export const MAX_OUTLIER_RUN = 2;
export const MIN_FIT_SHARE = 0.75;

/** The numbered text pages of a book, split by numbering kind (shared by pageNumberBreaks and
 *  fitPrintedPages, so both read one sequence). */
function numberedByKind(pages) {
  const byKind = { arabic: [], roman: [], folio: [] };
  let tagged = 0, other = 0;
  pages.forEach((r, idx) => {
    const v = parsePageNum(r.ocr);
    if (!v) return;
    tagged++;
    // A number read off a plate, a blank or a cover is a plate number, a stray pencil mark or
    // nothing at all — never a page in the text's sequence.
    if (NON_TEXT_TYPES.has(r.type)) { other++; return; }
    if (v.kind === 'other') { other++; return; }
    byKind[v.kind].push({ idx, p: r.p, value: v.value, span: v.span });
  });
  return { byKind, tagged, other };
}

/**
 * Fit ONE numbering's sequence: its rate, then runs of constant offset with short off-line runs
 * (misprints, misreads) merged away. Returns { judged:false, ... } for a sequence that is not a
 * pagination, else { judged:true, rate, fitShare, off, runs, outliers }.
 */
function fitNumbering(kind, seq) {
  if (seq.length < 4) return { info: { n: seq.length, judged: false, why: 'too-few' } };
  const ratios = [];
  for (let k = 1; k < seq.length; k++) {
    const ds = seq[k].p - seq[k - 1].p, dv = seq[k].value - seq[k - 1].value;
    if (ds >= 1 && ds <= 2 && dv > 0 && dv <= 4) ratios.push(dv / ds);
  }
  if (ratios.length < 3) return { info: { n: seq.length, judged: false, why: 'no-rate' } };
  ratios.sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)];
  const rate = [0.5, 1, 2].find(r => Math.abs(med - r) < 0.01);
  if (rate == null) return { info: { n: seq.length, judged: false, why: 'irregular', median: med } };
  // Offset of each number from its scan position, in scan units: constant along a clean run.
  const off = (e) => e.value / rate - e.p;
  // A "page number" that is really a section, entry or plate number (10, 10, 10, 11, …) or
  // two interleaved sequences fits its own rate on few adjacent pairs: not a pagination.
  let near = 0, fit = 0;
  for (let k = 1; k < seq.length; k++) {
    if (seq[k].p - seq[k - 1].p > MAX_SCAN_GAP) continue;
    near++; if (off(seq[k]) === off(seq[k - 1])) fit++;
  }
  const fitShare = near ? fit / near : 0;
  if (fitShare < MIN_FIT_SHARE) return { info: { n: seq.length, judged: false, why: 'irregular', rate, fitShare: +fitShare.toFixed(2) } };
  // Runs of equal offset; a run of ≤ MAX_OUTLIER_RUN numbers whose neighbouring runs share one
  // offset is a misprint or an OCR misread (…, 111, 118, 18, 114, …), not a leaf problem.
  const outliers = [];
  let runs = [];
  for (const e of seq) {
    const last = runs[runs.length - 1];
    if (last && off(last[0]) === off(e)) last.push(e); else runs.push([e]);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (let r = 1; r + 1 < runs.length && !changed; r++) {
      // try the next 1..m runs together (two different misreads in a row are two runs)
      for (let m = 1; r + m < runs.length; m++) {
        const mid = runs.slice(r, r + m).flat();
        if (mid.length > MAX_OUTLIER_RUN) break;
        const prev = runs[r - 1], next = runs[r + m];
        if (off(prev[0]) !== off(next[0]) || next[0].p - prev[prev.length - 1].p > MAX_SCAN_GAP + MAX_OUTLIER_RUN) continue;
        for (const e of mid) outliers.push({ numbering: kind, p: e.p, value: e.value, expected: Math.round((off(prev[0]) + e.p) * rate) });
        runs.splice(r - 1, m + 2, [...prev, ...next]);
        changed = true;
        break;
      }
    }
  }
  return { judged: true, rate, fitShare, off, runs, outliers };
}

export function pageNumberBreaks(pages) {
  const { byKind, tagged, other } = numberedByKind(pages);
  const out = { tagged, other, kinds: {}, breaks: [], outliers: [] };
  for (const [kind, seq] of Object.entries(byKind)) {
    const f = fitNumbering(kind, seq);
    if (!f.judged) { if (seq.length) out.kinds[kind] = f.info; continue; }
    const { rate, runs } = f;
    out.outliers.push(...f.outliers);
    const keep = runs.flat();
    let judged = 0, nBreaks = 0;
    for (let k = 1; k < keep.length; k++) {
      const a = keep[k - 1], b = keep[k];
      const ds = b.p - a.p;
      if (ds > MAX_SCAN_GAP) continue;
      judged++;
      const dv = b.value - a.value;
      const expected = rate * ds;
      if (dv === expected) continue;
      if (rate === 0.5 && ds === 1 && (dv === 0 || dv === 1)) continue; // recto-only numbering: a verso scan sits between
      let shape;
      if (dv === 0) shape = 'repeat';
      else if (dv < 0) shape = b.value <= 3 ? 'restart' : 'back';
      else if (dv > expected) shape = 'jump';
      else shape = 'extra';
      const between = pages.slice(a.idx + 1, b.idx).map(r => r.type || null);
      // Adjacent scans that CHAIN — the catchword of A opens B, or a word broken at A's foot
      // ends at B's head — are in order whatever the numbers say: the printer misnumbered, or
      // the OCR misread. Not when B is a duplicate scan: a copy of an earlier page continues
      // that page's predecessor, and chains by accident.
      if (b.idx === a.idx + 1 && pagesChain(pages, a.idx) && !isDuplicateOfRecent(pages, b.idx)) shape = 'misnumbered';
      nBreaks++;
      out.breaks.push({ numbering: kind, shape, from: a.p, to: b.p, fromValue: a.value, toValue: b.value, rate, d: dv - expected, between });
    }
    out.kinds[kind] = { n: seq.length, judged: true, rate, pairs: judged, breaks: nBreaks };
  }
  return out;
}

/**
 * O11 (#5142) — a `<page-num>` the book's own pagination says is wrong. The OCR reads the
 * number off the leaf, and on ~35 of the taxonomy's 78 books it read the wrong thing: a
 * photographer's mount number, a reversed show-through numeral (XLI for LIX), a chapter number
 * in red, an old edition's margin reference. With no model and no image, the reference is the
 * book itself: pageNumberBreaks() fits each numbering's line through its neighbours and sets
 * aside short runs off that line as outliers. Each outlier here becomes a per-page verdict with
 * the folio the pagination predicts and the likely cause:
 *   'show-through'   the tag is an anagram of the expected folio (mirrored or transposed digits)
 *   'other-counter'  far off the line — another counter on the leaf, not a misread digit
 *   'misread'        near the line — a digit misread, or the printer's misnumbering
 * The verdict says the TAG is wrong for this scan; it cannot say the image is the right leaf
 * (I1, image one leaf off its text, needs the image — checkAlignment() in page-alignment.mjs).
 */
export const PN_OTHER_COUNTER_MIN = 20;     // |tag − expected| at or above this, and …
export const PN_OTHER_COUNTER_SHARE = 0.5;  // … above this share of the expected value → another counter
const toRoman = (n) => {
  let out = '';
  for (const [v, r] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) while (n >= v) { out += r; n -= v; }
  return out;
};
const sortedChars = (t) => [...String(t).toLowerCase()].sort().join('');
export function pageNumMisreads(pages) {
  const { outliers } = pageNumberBreaks(pages);
  const byP = new Map(pages.map(r => [r.p, r]));
  return outliers.map((o) => {
    const raw = (String(byP.get(o.p)?.ocr || '').match(/<page-num>([\s\S]*?)<\/page-num>/i)?.[1] || '').trim();
    // folio values count sides (2n / 2n+1); print them back as the leaf number with its side
    const printed = (v) => o.numbering === 'roman' ? toRoman(v) : o.numbering === 'folio' ? `${v >> 1}${v & 1 ? 'v' : 'r'}` : String(v);
    const expectedPrinted = o.expected > 0 ? printed(o.expected) : null;
    const tagCore = asciiDigits(raw).replace(/[^\p{L}\p{N}]/gu, '');
    const gap = Math.abs(o.value - o.expected);
    let cause;
    if (expectedPrinted && tagCore.length > 1 && sortedChars(tagCore) === sortedChars(expectedPrinted) && tagCore.toLowerCase() !== expectedPrinted) cause = 'show-through';
    else if (gap >= PN_OTHER_COUNTER_MIN && gap > PN_OTHER_COUNTER_SHARE * Math.max(1, o.expected)) cause = 'other-counter';
    else cause = 'misread';
    return { p: o.p, numbering: o.numbering, tag: raw, value: o.value, expected: o.expected, expectedPrinted, cause };
  });
}

// ── 2b. the printed page a reader holds (#4291) ───────────────────────────────────────────

/**
 * The running-head number of a page whose OCR predates the <page-num> tag. Those vintages
 * transcribed the head as the first line ("DE TRIPL. ANIM. IN CORP. VISION. 217",
 * "210 TRACT. I. SECT. I. LIB. X."). Returns the arabic number standing first or last on a
 * short first line, else null. Tagged OCR never qualifies: there a missing <page-num> is the
 * model saying the leaf carries none, and the first line is a tag. One head is trusted no more
 * than one tag; fitPrintedPages keeps only numbers the book's own sequence corroborates.
 */
export function runningHeadNumber(ocr) {
  const o = String(ocr || '');
  if (/<(?:page-num|page-type|language|header)\b/i.test(o)) return null;
  const line = o.split('\n').map(l => l.replace(/&nbsp;/g, ' ').replace(/^[\s#*_>|]+|[\s*_|]+$/g, '')).find(Boolean);
  if (!line || line.length > 100) return null;
  const toks = line.split(/\s+/);
  for (const t of [toks[0], toks[toks.length - 1]]) {
    const d = asciiDigits(t).replace(/^[[(]+|[\]).,:;]+$/g, '');
    if (/^\d{1,4}$/.test(d)) return d;
  }
  return null;
}

/** A scan must sit in a run of at least this many numbers at one offset to be labelled. */
export const PRINTED_MIN_RUN = 3;

function printedLabel(kind, rate, value) {
  const fmt = (v) => kind === 'roman' ? toRoman(v) : String(v);
  if (kind === 'folio') return `${value >> 1}${value & 1 ? 'v' : 'r'}`;
  if (rate === 0.5) return Number.isInteger(value) ? `${fmt(value)}r` : `${fmt(Math.floor(value))}v`; // numbered rectos: leaves
  if (rate === 2) return `${fmt(value)}–${fmt(value + 1)}`; // one scan, two printed pages
  return fmt(value);
}

/**
 * The printed page number of every scan the book's own pagination vouches for (#4291): a
 * per-book offset model, never one page's say-so. `pages` = rows in scan order {p, ocr, type}.
 * Per numbering kind it runs the fit pageNumberBreaks uses, then labels a scan only when it
 * sits in a run of ≥ PRINTED_MIN_RUN numbers at one offset:
 *   method 'read'          its own number lies on the run's line
 *   method 'interpolated'  it carries no number (a chapter opening, a plate inside the
 *                          pagination) and lies between two run members ≤ MAX_SCAN_GAP scans
 *                          apart, so the constant offset fixes it
 * Never labelled: an outlier (a misread or a misprint; either way a citation from it is
 * wrong), a member of a shorter run, a scan two numberings both claim.
 * { head: true } also reads runningHeadNumber() on untagged OCR (source 'head', else 'tag').
 *
 * Returns { kinds, labels: Map<p, { label, numbering, rate, method, source, run_len,
 * fit_share }>, skipped: { outlier, short_run, conflict } }. `label` is a string: romans
 * ("xii"), leaves ("12v") and spreads ("12–13") are not integers.
 */
export function fitPrintedPages(pages, { head = false, minRun = PRINTED_MIN_RUN } = {}) {
  const source = new Map();
  const rows = pages.map((r) => {
    if (/<page-num>/i.test(r.ocr || '')) { source.set(r.p, 'tag'); return r; }
    const h = head ? runningHeadNumber(r.ocr) : null;
    if (h == null) return r;
    source.set(r.p, 'head');
    return { ...r, ocr: `<page-num>${h}</page-num>` };
  });
  const { byKind } = numberedByKind(rows);
  const kinds = {}, claims = new Map();
  const skipped = { outlier: 0, short_run: 0, conflict: 0 };
  for (const [kind, seq] of Object.entries(byKind)) {
    const f = fitNumbering(kind, seq);
    if (!f.judged) { if (seq.length) kinds[kind] = f.info; continue; }
    const fitShare = +f.fitShare.toFixed(2);
    kinds[kind] = { n: seq.length, judged: true, rate: f.rate, fitShare };
    const outP = new Set(f.outliers.map(o => o.p));
    const numberedP = new Set(seq.map(e => e.p));
    skipped.outlier += outP.size;
    for (const run of f.runs) {
      if (run.length < minRun) { skipped.short_run += run.length; continue; }
      const o = f.off(run[0]);
      const claim = (p, method) => {
        const value = (p + o) * f.rate;
        if (!(value > 0)) return;
        const c = { label: printedLabel(kind, f.rate, value), numbering: kind, rate: f.rate, method,
          ...(method === 'read' ? { source: source.get(p) } : {}), run_len: run.length, fit_share: fitShare };
        claims.set(p, [...(claims.get(p) || []), c]);
      };
      for (let k = 0; k < run.length; k++) {
        claim(run[k].p, 'read');
        const next = run[k + 1];
        if (next && next.p - run[k].p <= MAX_SCAN_GAP) {
          for (let p = run[k].p + 1; p < next.p; p++) if (!outP.has(p) && !numberedP.has(p)) claim(p, 'interpolated');
        }
      }
    }
  }
  const labels = new Map();
  for (const [p, cs] of claims) {
    if (cs.length === 1) labels.set(p, cs[0]);
    else skipped.conflict++;
  }
  return { kinds, labels, skipped };
}

/** Positive evidence that scan i+1 follows scan i: the catchword chains, or a word broken with
 *  a hyphen at the foot of i ends in lowercase at the head of i+1. (A sentence merely left
 *  open is NOT evidence — most pages end mid-sentence, so that test passes for a missing leaf.) */
export function pagesChain(pages, i) {
  const c = catchwordBoundary(pages, i);
  if (c?.judged && c.ok) return true;
  const a = proseOf(pages[i].ocr).replace(/[\s*_\]\)>]+$/u, ''), b = proseOf(pages[i + 1]?.ocr).replace(/^[^\p{L}]+/u, '');
  return /\p{L}[-‐‑⸗¬=]$/u.test(a) && /^\p{Ll}/u.test(b);
}

/** Is scan k a copy of scan k-1 or k-2 (the same leaf, or the same opening, photographed twice)? */
export function isDuplicateOfRecent(pages, k) {
  for (const g of [1, 2]) {
    const prev = pages[k - g];
    if (prev && pages[k] && duplicateScan(prev.ocr, pages[k].ocr).dup) return true;
  }
  return false;
}

// ── 3. duplicate consecutive scans ─────────────────────────────────────────────────────────

export const DUP_MIN_CHARS = 200;
export const DUP_MIN_DICE = 0.9;

// Two OCR runs of one page differ in exactly the places a fold can absorb: ſ read as f, a
// line-end hyphen kept or joined ("adhibe- bimus" / "adhibebimus").
const scanWords = (text) => words(String(text || '').replace(/[-‐‑⸗¬=]\s*\n?\s*(?=\p{Ll})/gu, '')).map(w => w.replace(/f/g, 's'));

function bigramsRaw(text) {
  const w = scanWords(text);
  const m = new Map();
  for (let k = 0; k + 1 < w.length; k++) { const g = w[k] + ' ' + w[k + 1]; m.set(g, (m.get(g) || 0) + 1); }
  return { m, n: Math.max(0, w.length - 1) };
}

const bigrams = cached('b', bigramsRaw);

/** Word-bigram Dice coefficient (multiset). */
export function bigramDice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.n || !B.n) return 0;
  let inter = 0;
  for (const [g, c] of A.m) { const d = B.m.get(g); if (d) inter += Math.min(c, d); }
  return (2 * inter) / (A.n + B.n);
}

/**
 * Is OCR N+1 the same page as OCR N? { judged:false, why } when either body is under
 * DUP_MIN_CHARS or is written in an unsegmented script (word bigrams mean nothing without
 * spaces — CJK, Tibetan, Thai), else { judged:true, dice, dup: dice ≥ DUP_MIN_DICE }.
 */
export function duplicateScan(ocrA, ocrB) {  // N vs N+1 (same scan twice) or N vs N+2 (an opening scanned twice)
  const a = proseOf(ocrA), b = proseOf(ocrB);
  if (a.length < DUP_MIN_CHARS || b.length < DUP_MIN_CHARS) return { judged: false, why: 'short' };
  if (CASELESS_UNSEGMENTED.test(a.slice(0, 400)) && (a.match(/\s/g) || []).length < a.length / 20) return { judged: false, why: 'unsegmented' };
  const dice = bigramDice(a, b);
  return { judged: true, dice: +dice.toFixed(3), dup: dice >= DUP_MIN_DICE };
}

// ── 4. truncated translations ──────────────────────────────────────────────────────────────

export const TRUNC_MIN_OCR_CHARS = 300; // reading length (letters + digits) ≈ 400 characters of prose

/** HTML entities count as one space, not six letters: a table padded with &nbsp; measured 18K. */
export const decodeEntities = (t) => String(t || '').replace(/&nbsp;/g, ' ').replace(/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, 'x').replace(/[ \t]{2,}/g, ' ').trim();

/** Text length that a translation can be held to: letters and digits only — not table pipes,
 *  LaTeX command names (\overline, \delta), entity names or [unclear] placeholders, each of
 *  which inflated a source to several times its reading length in the hand-read. */
export function readingLength(t) {
  const x = decodeEntities(t).replace(/\\[a-zA-Z]+/g, ' ').replace(/\[(?:unclear|illegible)[^\]]*\]/gi, ' ');
  return (x.match(/[\p{L}\p{N}]/gu) || []).length;
}

/** The OCR model sometimes returned its REASONING as the page ("thought The user wants a
 *  transcription … **1. Identify Language:**"). Not a transcription at all. */
export function ocrReasoningLeak(ocr) {
  const head = String(ocr || '').slice(0, 600);
  // Not a line merely starting with the English word "thought" — 19 of 20 such hits were prose.
  return /the user wants (?:a|me to|the)\b|\*\*\d\.\s*identify (?:the )?language|^\s*thought\s*\n+\s*(?:the user|okay|ok,|let me|i need|i will|\*\*)/i.test(head);
}
/**
 * The TRANSLATION model's reasoning stored as the page's English (#6056, taxonomy T-side twin of O15):
 * "*Wait, the prompt says:* Style: warm museum label", drafts and re-drafts, a checklist of its own rules.
 * A reader meets it as plain English under the book's title.
 *
 * TRANSLATION_LEAK_PREFILTER is the wide net the corpus walk hands to the server
 * (scripts/audit/translation-reasoning-leak.mjs); it must match every text translationReasoningLeak() matches,
 * and the unit test pins that on the fixtures. Change the two together, and re-walk after widening the net.
 */
export const TRANSLATION_LEAK_PREFILTER = new RegExp([
  'the prompt (?:says|asks|states|specifies|requires|wants|mentions|said|tells)',
  'wait, (?:the|i need|i should|i must|i missed|i see|let me|actually|looking at|no,)',
  '\\*\\(?wait[,:]',
  'warm museum',
  'the user (?:wants|asked|has provided|provided|is asking|says|said)',
  '[*(] ?self-correction|self-correction\\)?\\*?:',
  "let(?:'s| me) re-?(?:check|read|verify|examine|evaluate|think|translate)",
  '\\*revised (?:translation|note)',
  '(?:^|[\\n*(])(?:final )?final (?:check|polish|output|plan|structure)\\b',
  'writing response',
  '(?:^|\\n)thought\\n',
  "i (?:will|should|need to|must|'ll) (?:translate|transcribe|add a note|output|treat the|wrap)",
  'system prompt',
  '\\*[^*\\n]{0,50}\\b(?:check|correction|polish|drafting|refinement|formatting|constraints?)\\b[^*\\n]{0,40}:\\*',
  '(?:source|target) language:?\\*\\*',
  'the ocr (?:has|says|reads|shows|provides|lists|includes|gives|text (?:has|says|reads|is))',
  '<(?:meta|note|vocab|term|gloss|summary|keywords)>`? tags?\\b',
  'please (?:paste|provide|share|supply) the',
  'once you provide',
  "(?:text|input|transcription|ocr) (?:that )?you(?:'ve| have)? provided|the provided (?:text|ocr|transcription|input)",
  'ready to translate',
].join('|'), 'i');
/** The phrases that are the model talking to itself about the job, read off the corpus walk's candidates
 *  (2026-10-06). Each names the prompt, the user, the OCR as an input, a tag as a tag, or is a markdown
 *  scratchpad label. Bare first-person lines ("I will translate…", "Wait, I…") are NOT here: sermons, dialogues
 *  and translators' prefaces say them. */
const TRANSLATION_LEAK_RULE = new RegExp([
  'warm museum',
  'the prompt (?:says|asks|states|specifies|requires|wants|mentions|said|tells)',
  'the user (?:wants|asked|has provided|provided|is asking)',
  '[*(] ?self-correction',
  '\\*\\(?wait, (?:the (?:prompt|ocr|greek|latin|text|source|original|input|instructions?)\\b|looking at|i need|i should|i must|i missed|actually|let me)',
  'wait, (?:the (?:prompt|ocr|source|input|instructions?|user)\\b|the (?:text|original) (?:says|has|reads)|looking at the (?:ocr|source|image|text|prompt))',
  '\\*[^*\\n]{3,50} check:\\*|\\*(?:final )?(?:polish|formatting|drafting|refinement|constraints?)\\b[^*\\n]{0,40}:\\*',
  '(?:^|[\\n*(])(?:final )?final (?:check|polish|output|plan|structure)\\b[^\\n]{0,20}:',
  '\\(ready\\)\\.? writing response',
  '(?:source|target) language:?\\*\\*',
  '<(?:meta|note|vocab|term|gloss|summary|keywords)>`? tags?\\b',
  'system prompt',
  "let(?:'s| me) re-?(?:check|read|verify|examine|evaluate|translate) (?:the (?:ocr|source|latin|greek|german|text|english|first|prompt|instructions?|translation)|carefully)",
  "i (?:will|should|need to|must|'ll) (?:translate|transcribe|add a note|output|wrap)[^.\\n]{0,100}(?:the ocr|the prompt|the user|`<|museum|xml|markdown|as requested)",
  'please (?:paste|provide|share|supply) the (?:text|ocr|transcription|source|latin|page)',
  'once you provide the (?:text|ocr|transcription)',
  "the (?:text|input|transcription) (?:that )?you(?:'ve| have)? provided|the provided (?:ocr|transcription|input)\\b|the provided text (?:is|was|appears|contains|seems|has)",
].join('|'), 'i');
/** What the reader's metadata panel holds and the page body does not (NotesRenderer, showMetadata=false). */
const TRANSLATION_PANEL_BLOCKS = /<(meta|summary|keywords|vocab)>[\s\S]*?<\/\1>/gi;
const TRANSLATION_OCR_TALK = /the ocr (?:has|says|reads|shows|provides|lists|includes|gives|text (?:has|says|reads|is))/i;

/**
 * { kind, phrase, readerVisible } when a stored translation carries the model's reasoning, else null.
 *   kind 'reasoning'      one of TRANSLATION_LEAK_RULE's phrases
 *   kind 'thought-token'  the page opens with the bare word "thought" on its own line (the thinking channel's
 *                         label, with or without the thinking after it)
 * readerVisible: the phrase is in the page body, not only inside a block the reader keeps in its metadata panel.
 */
export function translationReasoningLeak(text) {
  const t = String(text || '');
  const body = t.replace(TRANSLATION_PANEL_BLOCKS, ' ');
  let m = body.match(TRANSLATION_LEAK_RULE);
  if (m) return { kind: 'reasoning', phrase: m[0].replace(/\s+/g, ' ').trim(), readerVisible: true };
  m = t.match(TRANSLATION_LEAK_RULE);
  if (m) return { kind: 'reasoning', phrase: m[0].replace(/\s+/g, ' ').trim(), readerVisible: false };
  if (/^thought[ \t]*\n/.test(t)) return { kind: 'thought-token', phrase: 'thought', readerVisible: true };
  return null;
}
/** A milder, separate thing: a translator's note that tells the reader what "the OCR" reads. Not reasoning,
 *  but pipeline vocabulary in the page body. True only when it survives outside the metadata-panel blocks. */
export function translationOcrTalk(text) {
  return TRANSLATION_OCR_TALK.test(String(text || '').replace(TRANSLATION_PANEL_BLOCKS, ' '));
}
export const DESCRIBED_PAGE = /^\W{0,3}(?:the image|this image|this page|the page (?:is|appears|shows|contains)|image (?:shows|of)|this (?:is a|appears)|a (?:blank|largely blank))/i;

/**
 * Translation body length / source body length for one page, or { judged:false, why }.
 * Judged only on prose pages (not NON_PROSE types) whose source body is ≥ TRUNC_MIN_OCR_CHARS.
 * The raw ratio differs by source language (Chinese → English runs ~3×, Latin ~1.1×), so the
 * caller normalises by the language median before flagging.
 */
export function truncationRatio({ ocr, tr, type }) {
  if (!tr || !String(tr).trim()) return { judged: false, why: 'no-translation' };
  if (NON_PROSE_TYPES.has(type)) return { judged: false, why: 'non-prose' };
  // A page printed in two languages (Greek with a Latin crib, Migne-style) carries its text
  // twice; one translation of it is half the source by design.
  if (sourceLanguageCount(ocr) > 1) return { judged: false, why: 'multilingual-source' };
  if (ocrReasoningLeak(ocr)) return { judged: false, why: 'ocr-reasoning-leak' };
  const srcText = decodeEntities(proseOf(ocr));
  // The model sometimes DESCRIBES a page it cannot read instead of transcribing it.
  if (DESCRIBED_PAGE.test(srcText)) return { judged: false, why: 'source-is-description' };
  const src = readingLength(proseOf(ocr)), out = readingLength(trProseOf(tr));
  if (src < TRUNC_MIN_OCR_CHARS) return { judged: false, why: 'short-source' };
  return { judged: true, src, tr: out, ratio: +(out / src).toFixed(3) };
}

/** How many languages the OCR's own <language> tag names ("Greek, Latin" → 2). 0 if untagged. */
export function sourceLanguageCount(ocr) {
  const m = String(ocr || '').match(/<(?:language|lang)>([^<]{1,80})<\/(?:language|lang)>/i);
  if (!m) return 0;
  return m[1].replace(/\(.*?\)/g, " ").split(/\s*(?:,|;|\/|\+|&|\band\b|\bwith\b)\s*/i).map(x => x.replace(/\(.*?\)/g, '').trim()).filter(Boolean).length;
}

export const NON_PROSE_TYPES = new Set([...NON_TEXT_TYPES, 'index', 'toc', 'title-page', 'errata', 'colophon', 'table', 'music', 'score']);

// ── 5. echoed source ───────────────────────────────────────────────────────────────────────

export const ECHO_MIN_CHARS = 120;
export const ECHO_WHOLE_PAGE_SHARE = 0.5;
// English function words that are not also Latin/Romance words ('a', 'in', 'is', 'at', 'an' are).
const EN_STOP = new Set(['the', 'of', 'and', 'to', 'that', 'which', 'was', 'for', 'with', 'by', 'from', 'this', 'are', 'be', 'it', 'as', 'his', 'their',
  'he', 'she', 'will', 'have', 'has', 'not', 'would', 'should', 'been', 'were', 'they', 'into', 'upon', 'when', 'there', 'these', 'those', 'its', 'or', 'on', 'her', 'we', 'you']);

/** Fold for run comparison: letters and single spaces, lowercase, marks and ſ normalised. */
export function foldRun(text) {
  return decodeEntities(text).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/ſ/g, 's').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Longest run a and b share (40-char shingles of b, extended) — same method as
 *  translation-page-boundaries sharedRun, on folded text. */
export function longestSharedRun(a, b, min = ECHO_MIN_CHARS) {
  if (a.length < min || b.length < min) return { len: 0, text: '' };
  const K = 40, idx = new Map();
  for (let i = 0; i + K <= b.length; i += 8) { const s = b.slice(i, i + K); if (!idx.has(s)) idx.set(s, i); }
  let best = 0, bestA = -1;
  for (let i = 0; i + K <= a.length; i++) {
    const j = idx.get(a.slice(i, i + K)); if (j == null) continue;
    let back = 0; while (i - back > 0 && j - back > 0 && a[i - back - 1] === b[j - back - 1]) back++;
    let L = K; while (i + L < a.length && j + L < b.length && a[i + L] === b[j + L]) L++;
    if (L + back > best) { best = L + back; bestA = i - back; }
    i += Math.max(0, L - K);
  }
  return { len: best, text: bestA >= 0 ? a.slice(bestA, bestA + Math.min(best, 240)) : '' };
}

/** A shared run that is a list of names, numbers or references rather than prose: most of its
 *  words are capitalised in the source, digits, or one/two letters (sigla, "cap. 3 v. 12"). */
export function looksLikeListRun(printedRun) {
  const w = String(printedRun || '').split(/\s+/).filter(Boolean);
  if (!w.length) return true;
  const listy = w.filter(x => /^\p{Lu}/u.test(x) || /\d/.test(x) || x.replace(/[^\p{L}]/gu, '').length <= 2).length;
  return listy / w.length >= 0.6;
}

/**
 * Does the translation reproduce its source verbatim? { judged:false, why } for an English (or
 * modernised-English) source — the "translation" there is a modernisation and shares runs by
 * design — or for too little text; else { judged:true, len, share, echo, listLike, text }.
 * `echo` = a shared folded run ≥ ECHO_MIN_CHARS that is not a name/citation list.
 */
export function echoedSource({ ocr, tr, lang }) {
  if (!tr || !String(tr).trim()) return { judged: false, why: 'no-translation' };
  if (/^(english|en|eng)$/i.test(String(lang || '').trim())) return { judged: false, why: 'english-source' };
  const src = proseOf(ocr), out = trProseOf(tr);
  const a = foldRun(out), b = foldRun(src);
  if (a.length < ECHO_MIN_CHARS || b.length < ECHO_MIN_CHARS) return { judged: false, why: 'short' };
  const run = longestSharedRun(a, b);
  if (run.len < ECHO_MIN_CHARS) return { judged: true, len: run.len, share: +(run.len / a.length).toFixed(3), echo: false };
  // Recover the printed (unfolded) words of the run from the source to judge list-likeness.
  const head = run.text.split(' ').slice(0, 3).join(' ');
  const srcWords = src.split(/\s+/);
  let printed = '';
  for (let k = 0; k < srcWords.length; k++) {
    if (foldRun(srcWords.slice(k, k + 3).join(' ')) === head) { printed = srcWords.slice(k, k + 40).join(' '); break; }
  }
  const share = run.len / a.length;
  // A list run is exempt only while it is a PART of the page: when half the "translation" is
  // the source verbatim, the page was echoed whatever the run looks like (the #4681 p.109
  // repair echoed a garbled index page — all capitals, all "list").
  const listLike = looksLikeListRun(printed || run.text);
  const t = run.text.split(' ').filter(Boolean);
  const shortShare = t.filter(w => w.length <= 3 && !/\d/.test(w)).length / Math.max(1, t.length);
  const digitShare = t.filter(w => /\d/.test(w)).length / Math.max(1, t.length);
  const englishShare = t.filter(w => EN_STOP.has(w)).length / Math.max(1, t.length);
  // English already in the source (a Loeb note, a caption, a quoted title) is copied, not echoed.
  const englishInSource = englishShare >= 0.12;
  // Prose has function words; a list of names (angels, lexicon heads) has almost none.
  const proseLike = shortShare >= 0.1 && digitShare < 0.2;
  const echo = !englishInSource && proseLike && (!listLike || share >= ECHO_WHOLE_PAGE_SHARE);
  // Two tiers. A WHOLE-PAGE echo (the source is most of the "translation") is the defect; a
  // shorter run is usually a quotation the translator kept (Latin inside German, Greek inside
  // French) — measured at 3/20 real before this split.
  return { judged: true, len: run.len, share: +share.toFixed(3), echo, wholePage: echo && share >= ECHO_WHOLE_PAGE_SHARE, listLike, englishInSource, proseLike, text: run.text.slice(0, 200) };
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// Page-error taxonomy quick wins (2026-09-25, .claude/docs/page-error-taxonomy.md):
//   6. vocabAbsent()        O5 · #5136 — the page's own <vocab> names words its body lacks
//   7. repeatedBlocks()     O4 · #5135 — a block of ≥ REPEAT_MIN_TOKENS repeated inside one page
// Same contract as 1–5: pure, no model, explicit { judged:false, why } for what cannot be read.
// ══════════════════════════════════════════════════════════════════════════════════════════

// ── 6. vocab words absent from the body (O5) ──────────────────────────────────────────────

export const VOCAB_MIN_TERMS = 3;
export const VOCAB_STEM_MIN = 5;   // letters of a term that must open some word of the body

/** The `<vocab>` terms of a page in printed form (the tag's own separators: commas, semicolons,
 *  newlines, bullets, "·"). A parenthetical gloss ("三昧 (Samadhi)") is dropped — the head is
 *  the page's word, the gloss the model's. Empty when the page carries no <vocab>. */
export function parseVocab(ocr) {
  const m = String(ocr || '').match(/<vocab>([\s\S]*?)<\/vocab>/i);
  if (!m) return [];
  return m[1].replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')
    .split(/\s*(?:[,;·•\n|]|\s-\s)\s*/).map(t => t.trim().replace(/^[\s"'“”‘’*_]+|[\s"'“”‘’*_.:]+$/g, '')).filter(t => t && /\p{L}/u.test(t));
}

/** Compare-fold for vocab lookup: foldWord's letter folding per word, words joined by one space
 *  (so a multi-word term is looked up as a phrase), digits kept. */
const foldPhrase = (t) => String(t || '').split(/\s+/).map(w => foldWord(w) || w.replace(/[^\p{N}]/gu, '')).filter(Boolean).join(' ');

/** Fold of the OCR body WITHOUT its vocab (and other wrapper) blocks, with word boundaries kept
 *  as single spaces so a prefix test can anchor on a word start. */
const foldedBodyOf = cached('vb', (ocr) => ' ' + foldPhrase(proseOf(ocr)) + ' ');

/**
 * Which of the page's own `<vocab>` terms do not occur in its body? The OCR prompt asks for key
 * terms "from THAT page only", so a term the body lacks is either a line the transcription
 * dropped (O5 — the Varro p.149 case, where the missing terms sat in 13 dropped lines) or a
 * term the model invented. Both are defects; the hand-read tells them apart.
 *
 * A term is PRESENT when its fold occurs in the folded body, or — for an inflected language —
 * when its first max(VOCAB_STEM_MIN, len−3) letters open some body word ("transmutatio" ~
 * "transmutationis"; "Ptolomæus" ~ "Ptolomæi"). Unsegmented scripts (CJK, Tibetan) get a plain
 * substring test, which their lack of inflection makes exact.
 *
 * UNJUDGEABLE: fewer than VOCAB_MIN_TERMS terms; a body under TRUNC_MIN_OCR_CHARS reading
 * length; NON_PROSE page types (an index or table lists more than its body "says").
 */
export function vocabAbsent({ ocr, type }) {
  const terms = parseVocab(ocr);
  if (terms.length < VOCAB_MIN_TERMS) return { judged: false, why: terms.length ? 'few-terms' : 'no-vocab' };
  if (NON_PROSE_TYPES.has(type)) return { judged: false, why: 'non-prose' };
  if (readingLength(proseOf(ocr)) < TRUNC_MIN_OCR_CHARS) return { judged: false, why: 'short-source' };
  const body = foldedBodyOf(ocr);
  const bodyScript = dominantScript(body);
  const absent = [], absentExact = [], shapes = { keyword: 0, otherScript: 0, short: 0 };
  for (const term of terms) {
    const f = foldPhrase(term);
    if (!f) continue;
    if (body.includes(f)) continue;
    absentExact.push(term);
    // Shapes the 300-book test walk showed to be the model's KEYWORDS, not the page's words
    // (63% of judged pages flagged before these): a Greek letter or sigil (≤ 2 letters), a term
    // in another script than the body (a transliteration: "Peah, Ruach" on a Hebrew page), and
    // a multi-word label whose words are all absent ("textual criticism", "Lex Censoria").
    if (f.replace(/[^\p{L}]/gu, '').length <= 2) { shapes.short++; continue; }
    if (bodyScript && dominantScript(f) && dominantScript(f) !== bodyScript) { shapes.otherScript++; continue; }
    const wordsOf = f.split(' ');
    if (CASELESS_UNSEGMENTED.test(f)) { absent.push(term); continue; }
    // stem test per word: an inflected language changes the last 1–3 letters ("transmutatio" ~
    // "transmutationis", "bonum" ~ "boni"); a word is present when the body has a word opening
    // with its stem. A phrase counts as present when ANY of its words is.
    const present = wordsOf.some(w => {
      if (w.length < 3) return false;
      const stem = w.length <= 6 ? w.slice(0, Math.max(3, w.length - 2)) : w.slice(0, Math.max(VOCAB_STEM_MIN, w.length - 3));
      return body.includes(' ' + stem);
    });
    if (present) continue;
    if (wordsOf.length > 1) { shapes.keyword++; continue; }
    absent.push(term);
  }
  const share = +(absent.length / terms.length).toFixed(3);
  const capitalised = absent.filter(t => /^\p{Lu}/u.test(t)).length;
  return { judged: true, terms: terms.length, absent, absentExact, shapes, capitalised, share, flag: absent.length > 0 };
}

/** The script most of a folded text's letters belong to, or null. */
export function dominantScript(text) {
  const counts = { latin: 0, greek: 0, hebrew: 0, arabic: 0, cyrillic: 0, han: 0, tibetan: 0, devanagari: 0, syriac: 0, armenian: 0 };
  for (const ch of String(text || '').slice(0, 2000)) {
    if (/\p{Script=Latin}/u.test(ch)) counts.latin++;
    else if (/\p{Script=Greek}/u.test(ch)) counts.greek++;
    else if (/\p{Script=Hebrew}/u.test(ch)) counts.hebrew++;
    else if (/\p{Script=Arabic}/u.test(ch)) counts.arabic++;
    else if (/\p{Script=Cyrillic}/u.test(ch)) counts.cyrillic++;
    else if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch)) counts.han++;
    else if (/\p{Script=Tibetan}/u.test(ch)) counts.tibetan++;
    else if (/\p{Script=Devanagari}/u.test(ch)) counts.devanagari++;
    else if (/\p{Script=Syriac}/u.test(ch)) counts.syriac++;
    else if (/\p{Script=Armenian}/u.test(ch)) counts.armenian++;
  }
  let best = null, n = 0;
  for (const [k, v] of Object.entries(counts)) if (v > n) { best = k; n = v; }
  return n ? best : null;
}

// ── 7. repeated blocks inside one page (O4) ───────────────────────────────────────────────

export const REPEAT_MIN_TOKENS = 20;   // shingle length, segmented scripts (words)
export const REPEAT_MIN_CHARS = 40;    // shingle length, unsegmented scripts (characters)
export const LOOP_MAX_PERIOD = 6;      // a repeat whose period is this short is the KNOWN token loop
export const LOOP_MAX_TTR = 0.15;      // type/token ratio under which ocr-loop-guard already refuses the page
export const LOOP_MIN_COPIES = 10;     // a block copied this often is degeneration, not a doubled leaf

/** Repeat units of a page: folded words that carry a letter or digit (table pipes, rules and
 *  punctuation runs are typography, not text), or single characters for an unsegmented script. */
export function repeatUnits(prose) {
  const p = String(prose || '');
  const sample = p.slice(0, 600);
  const unsegmented = CASELESS_UNSEGMENTED.test(sample) && (sample.match(/\s/g) || []).length < sample.length / 20;
  // Combining marks are kept: in an abugida (Devanagari) or pointed script (Hebrew, Arabic) the
  // vowel signs ARE the word, and foldWord's mark-stripping made different words collide
  // (वयघर for व्याघ्र) — measured in the 2026-10-01 walk.
  if (unsegmented) return { units: [...p.normalize('NFC').replace(/\s+/g, '')].filter(c => /[\p{L}\p{N}\p{M}]/u.test(c)), K: REPEAT_MIN_CHARS, unsegmented };
  const keepMarks = MARKED_SCRIPTS.has(dominantScript(sample));
  const unit = keepMarks ? (w) => w.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '') : (w) => foldWord(w) || w.replace(/[^\p{N}]/gu, '');
  return { units: p.split(/\s+/).map(unit).filter(Boolean), K: REPEAT_MIN_TOKENS, unsegmented };
}
const MARKED_SCRIPTS = new Set(['devanagari', 'arabic', 'hebrew', 'syriac', 'armenian']);
/** Scripts whose liturgical texts repeat by design (sūtra refrains, dhāraṇī): a repeated block
 *  there cannot be told from a transcription fault by the text alone — 70% of the first walk's
 *  flags (3,751 of 5,358), the shape #5275 met in the Tibetan leaf-drift guard. */
export const REFRAIN_SCRIPTS = new Set(['tibetan']);

/** Smallest period p ≤ maxP such that run[k] === run[k+p] for every k, else 0. */
function periodOf(run, maxP) {
  for (let p = 1; p <= Math.min(maxP, run.length >> 1); p++) {
    let ok = true;
    for (let k = 0; k + p < run.length; k++) if (run[k] !== run[k + p]) { ok = false; break; }
    if (ok) return p;
  }
  return 0;
}

/**
 * Does one page's OCR repeat a block of itself? Shingles of K units; a shingle seen before is
 * extended to the maximal repeated run. Reports the longest such run, how many copies of its
 * opening shingle the page holds, and the share of units covered by ANY repeated shingle.
 *
 * `kind`: 'loop' when the longest run has a period ≤ LOOP_MAX_PERIOD (one phrase over and over —
 * the KNOWN token-level degeneration, caught by ocr-loop-guard's type/token ratio); 'block'
 * otherwise (a stanza, a paragraph, a whole leaf transcribed twice — the class #5135 names, whose
 * type/token ratio is normal). `flag` is set for 'block' only.
 *
 * UNJUDGEABLE: fewer than 2K units; a REFRAIN_SCRIPTS page (Tibetan).
 */
export function repeatedBlocks(ocr) {
  if (REFRAIN_SCRIPTS.has(dominantScript(proseOf(ocr)))) return { judged: false, why: 'refrain-script' };
  const { units, K, unsegmented } = repeatUnits(proseOf(ocr));
  if (units.length < 2 * K) return { judged: false, why: 'short' };
  const first = new Map();
  const covered = new Uint8Array(units.length);
  let best = { len: 0, at: -1, prev: -1 };
  for (let i = 0; i + K <= units.length; i++) {
    const s = units.slice(i, i + K).join('\u0001');
    const j = first.get(s);
    if (j === undefined) { first.set(s, i); continue; }
    for (let k = i; k < i + K; k++) covered[k] = 1;
    let L = K;
    while (i + L < units.length && units[j + L] === units[i + L] && j + L < i) L++;
    if (L > best.len) best = { len: L, at: i, prev: j };
    for (let k = i; k < i + L; k++) covered[k] = 1;
    i += Math.max(0, L - K); // continue after the run (a short-period loop extends less than K)
  }
  if (best.len === 0) return { judged: true, units: units.length, K, longest: 0, copies: 1, share: 0, kind: 'none', flag: false };
  const run = units.slice(best.at, best.at + best.len);
  const period = periodOf(run, LOOP_MAX_PERIOD);
  const head = units.slice(best.prev, best.prev + K).join('\u0001');
  let copies = 0;
  for (let i = 0; i + K <= units.length; i++) if (units.slice(i, i + K).join('\u0001') === head) { copies++; i += K - 1; }
  let share = 0; for (const c of covered) share += c;
  share = +(share / units.length).toFixed(3);
  const types = new Set(units).size / units.length;
  // The KNOWN degeneration (ocr-loop-guard, PR #3273): a short period, a type/token ratio under
  // LOOP_MAX_TTR on a segmented script, or a block repeated LOOP_MIN_COPIES times or more. What
  // is left — a stanza or a leaf transcribed two or three times with normal vocabulary — is O4.
  const loop = period > 0 || (!unsegmented && types < LOOP_MAX_TTR) || copies >= LOOP_MIN_COPIES;
  const kind = loop ? 'loop' : 'block';
  return {
    judged: true, units: units.length, K, longest: best.len, copies, share, period, ttr: +types.toFixed(3), kind, unsegmented,
    flag: kind === 'block', sample: run.slice(0, unsegmented ? 60 : 24).join(unsegmented ? '' : ' '),
  };
}

// ── 8. text hidden in the continuity <meta> ────────────────────────────────────────────────

export const META_PAYLOAD_MIN_WORDS = 8;
export const META_COPIED_SHARE = 0.6;
export const META_UNMATCHED_SHARE = 0.2;
export const META_WHOLE_PAGE_SHARE = 0.8;

const CONT_MARKER = /^[\s.…]*continue[sd]?\s+from\s+(?:the\s+)?previous\s+page\b/i;
// "continues from previous page's discussion of …", "…, where the author …": a sentence ABOUT
// the previous page (the v2–v5 page summary), not text standing in for it.
const DESCRIPTIVE_LEAD = /^(?:['’]s\b|\s*,|\s+(?:and|where|which|in which|with|discussing|detailing|describing|regarding|concerning|about)\b)/i;
const tagless = (t) => String(t || '').replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
const trigrams = (w) => { const g = new Set(); for (let i = 0; i + 3 <= w.length; i++) g.add(w.slice(i, i + 3).join(' ')); return g; };

/**
 * The continuity <meta> of a translation — `<meta>continues from previous page…</meta>`, the
 * marker the translation prompt asks for when a page opens mid-sentence — or null when there is
 * none. `form` is 'bare' (the marker alone), 'descriptive' (a sentence about the previous page)
 * or 'text' (the marker, then `payload`: words standing where page text would).
 */
export function continuityMeta(tr) {
  for (const m of String(tr || '').matchAll(/<meta>([\s\S]*?)<\/meta>/gi)) {
    const mk = m[1].match(CONT_MARKER);
    if (!mk) continue;
    const rest = m[1].slice(mk[0].length);
    if (DESCRIPTIVE_LEAD.test(rest)) return { form: 'descriptive', payload: '', words: 0 };
    const payload = tagless(rest).replace(/^[\s:.…,;—–-]+/, '').replace(/\s+/g, ' ').trim();
    const n = words(payload).length;
    return { form: n ? 'text' : 'bare', payload, words: n };
  }
  return null;
}

/**
 * Is page text hidden inside the continuity <meta>? Every reader and export strips <meta>,
 * content and all (stripEditorialWrappers), so whatever the translator writes after the marker
 * is text no reader sees. Returns null when the page has no continuity meta, else
 *   { judged:true, form, words, shape, wholePage, inPrev?, text? }  with shape
 *     'bare' | 'descriptive'  nothing hidden
 *     'short'        a payload under META_PAYLOAD_MIN_WORDS — too few words to compare
 *     'copied'       ≥ META_COPIED_SHARE of the payload's word trigrams are in the previous
 *                    page's translation: the continuity context handed back, a hidden duplicate
 *     'hidden-text'  < META_UNMATCHED_SHARE are: the words are not the previous page's. Hand-read
 *                    (EXPERIMENTS.md 2026-09-30, tq9) they are this page's OWN opening lines,
 *                    translated into the meta, far more often than an invented lead-in — either
 *                    way the reader meets the page without them
 *     'partial'      in between
 *   { judged:false, why:'no-previous-translation', form, words, wholePage }  a payload with
 *                    nothing to compare it to
 * `wholePage`: the payload is ≥ META_WHOLE_PAGE_SHARE of everything the translation says — the
 * page reads as empty.
 */
export function metaPayload({ tr, prevTr }) {
  const cm = continuityMeta(tr);
  if (!cm) return null;
  if (cm.form !== 'text') return { judged: true, form: cm.form, words: 0, shape: cm.form, wholePage: false };
  const hidden = readingLength(cm.payload), shown = readingLength(trProseOf(tr));
  const wholePage = cm.words >= META_PAYLOAD_MIN_WORDS && hidden / Math.max(1, hidden + shown) >= META_WHOLE_PAGE_SHARE;
  const base = { form: 'text', words: cm.words, wholePage };
  if (cm.words < META_PAYLOAD_MIN_WORDS) return { judged: true, ...base, shape: 'short' };
  if (!prevTr || !String(prevTr).trim()) return { judged: false, why: 'no-previous-translation', ...base };
  const prev = trigrams(words(tagless(prevTr)));
  const mine = [...trigrams(words(cm.payload))];
  const inPrev = mine.filter(g => prev.has(g)).length / Math.max(1, mine.length);
  const shape = inPrev >= META_COPIED_SHARE ? 'copied' : inPrev < META_UNMATCHED_SHARE ? 'hidden-text' : 'partial';
  return { judged: true, ...base, shape, inPrev: +inPrev.toFixed(2), text: cm.payload.slice(0, 200) };
}
