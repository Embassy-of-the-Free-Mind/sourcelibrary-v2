// PRIOR ART: scripts/lib/page-integrity.mjs fitPrintedPages (#4291) fits pages.printed_page, and reads
// <page-num>, which #5699 showed is invented on the very books this concerns; it also has no descending
// rate, so a book stored back to front gets nothing. scripts/eval/page-marker-order.mjs reads the running
// heads and is reused here (pageMarkers, parsers), but it only flags order; it never says which number a
// frame carries. scripts/audit/printed-page-image-read.mjs reads images with a paid model to reseat text.
/**
 * printed-number-runs: which printed number does each frame carry, and where are we sure (#8041)?
 *
 * Pure: no I/O. `findRuns` proposes straight runs from markers, `checkpoints` picks the frames to open,
 * `judgeRun` decides from blind reads of those images, and `rowsForRun` writes out a confirmed run.
 *
 * A run is a stretch of the reader's page list over which the printed number moves one per frame, up or
 * down, because a book stored back to front (#5699) is still a straight line. Frames are positions in
 * the reader's list (not page_number), so a hidden duplicate does not read as a missing page.
 *
 * Misread markers are tolerated (Syriac heads read 366, S66, 384, 352 in a row): only markers that
 * agree exactly on one line count as anchors. The run stops at its last anchor: no number is ever
 * extrapolated past what was read, and a stretch of more than MAX_ANCHOR_GAP frames without an agreeing
 * marker ends it, as does a competing line. A marker never decides on its own: images do (judgeRun).
 */
import { stripMarkupTags } from './strip-markup-tags.mjs';
import { pageMarkers, parseChineseNumeral, parseDigits, parseHebrewNumeral } from '../eval/page-marker-order.mjs';

export const MAX_ANCHOR_GAP = 10;
export const MIN_ANCHORS = 5;
export const MIN_AGREE_SHARE = 0.5;

const ROMAN = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const ROMAN_VALUE = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
export function parseRoman(tok) {
  const t = String(tok).trim();
  if (!t || !ROMAN.test(t)) return null;
  const vs = [...t.toLowerCase()].map(c => ROMAN_VALUE[c]);
  return vs.reduce((sum, v, i) => sum + (v < (vs[i + 1] || 0) ? -v : v), 0);
}
export function toRoman(n, upper = false) {
  const table = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return upper ? out.toUpperCase() : out;
}
const INDIC = '٠١٢٣٤٥٦٧٨٩', PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const HEB_UNITS = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
export function toHebrewNumeral(n) {
  let out = '';
  while (n >= 400) { out += 'ת'; n -= 400; }
  if (n % 100 === 15) { n -= 15; out += HEB_UNITS.filter(([v]) => v === n).map(([, c]) => c).join('') + 'טו'; return out; }
  if (n % 100 === 16) { n -= 16; out += HEB_UNITS.filter(([v]) => v === n).map(([, c]) => c).join('') + 'טז'; return out; }
  for (const [v, c] of HEB_UNITS) if (n >= v) { out += c; n -= v; }
  return out;
}
const ZH_DIGIT = '〇一二三四五六七八九';
/** Chinese numerals in the two forms books print: positional (二七三) or with units (二百七十三). */
export function toChineseNumeral(n, positional = true) {
  if (positional) return [...String(n)].map(d => ZH_DIGIT[d]).join('');
  const parts = [];
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  if (h) parts.push(`${ZH_DIGIT[h]}百`);
  if (t) parts.push(`${h || t > 1 ? ZH_DIGIT[t] : ''}十`);
  else if (h && u) parts.push('〇');
  if (u) parts.push(ZH_DIGIT[u]);
  return parts.join('');
}

/**
 * Read one printed token, however it is printed. Returns { value, numbering, side?, form? } or null.
 * `numbering`: arabic, arabic-indic, persian, hebrew, chinese, roman, folio. A folio has a side, as
 * printed (r/v, or a/b); `value` is the leaf and the line is fitted on sides (2 × leaf + verso).
 */
export function parsePrintedToken(raw) {
  const t = String(raw ?? '').trim().replace(/^[\[(\-–—.\s·*]+|[\])\-–—.\s·*:]+$/g, '');
  if (!t) return null;
  const fol = /^(?:fol(?:io)?\.?\s*|f\.?\s*)?([0-9٠-٩۰-۹]{1,4})\s*([rvab])$/i.exec(t);
  if (fol) {
    const side = fol[2].toLowerCase();
    return { value: parseDigits(fol[1]), numbering: 'folio', side, form: side === 'a' || side === 'b' ? 'ab' : 'rv' };
  }
  const bare = t.replace(/^(?:p\.|pag\.|s\.)\s*/i, '');
  if (/^[٠-٩]+$/.test(bare)) return { value: parseDigits(bare), numbering: 'arabic-indic' };
  if (/^[۰-۹]+$/.test(bare)) return { value: parseDigits(bare), numbering: 'persian' };
  if (/^[0-9]{1,4}$/.test(bare)) return { value: Number(bare), numbering: 'arabic' };
  if (/^[0-9٠-٩۰-۹]+$/.test(bare)) { const v = parseDigits(bare); return v === null ? null : { value: v, numbering: 'arabic-indic' }; }
  const heb = parseHebrewNumeral(bare);
  if (heb !== null) return { value: heb, numbering: 'hebrew' };
  const zh = parseChineseNumeral(bare);
  if (zh !== null) return { value: zh, numbering: 'chinese', form: /[十百千]/.test(bare) ? 'units' : 'positional' };
  const rom = parseRoman(bare);
  if (rom !== null && rom > 0) return { value: rom, numbering: 'roman', form: bare === bare.toUpperCase() ? 'upper' : 'lower' };
  return null;
}

/** The label a number carries in its own numeral system, as printed. */
export function labelFor(value, numbering, { side, form } = {}) {
  switch (numbering) {
    case 'arabic-indic': return [...String(value)].map(d => INDIC[d]).join('');
    case 'persian': return [...String(value)].map(d => PERSIAN[d]).join('');
    case 'hebrew': return toHebrewNumeral(value);
    case 'chinese': return toChineseNumeral(value, form !== 'units');
    case 'roman': return toRoman(value, form === 'upper');
    case 'folio': return `${value}${side}`;
    default: return String(value);
  }
}

// One line per family: all of the Hindu-Arabic, Hebrew and Chinese forms count the same way; a roman
// front matter or a foliation is a numbering of its own and cannot share a line with the body.
const family = (n) => (n === 'roman' ? 'roman' : n === 'folio' ? 'folio' : 'num');
const position = (p) => (p.numbering === 'folio' ? 2 * p.value + (p.side === 'v' || p.side === 'b' ? 1 : 0) : p.value);

/** A frame's marker from its OCR head and tail, never from <page-num>. Returns a parsed token or null. */
export function frameMarker(head, tail) {
  const mk = pageMarkers(head, tail);
  if (mk.P !== null) return parsePrintedToken(mk.tok) ?? { value: mk.P, numbering: 'arabic' };
  // pageMarkers parses neither romans nor sided folios: look in the same places it does.
  const hm = /<header(?:\s[^>]*)?>([\s\S]*?)<\/header>/i.exec(head || '');
  const toks = hm ? stripMarkupTags(hm[1], ' ').trim().split(/\s+/).filter(Boolean) : [];
  const centred = /->\s*([^<\n]{1,12}?)\s*<-/.exec(head || '');
  const bare = (s) => stripMarkupTags(String(s || '').replace(/<(vocab|meta|sig|margin|note|gloss|header|page-num|warning)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, ''), '').split('\n').map(l => l.trim()).filter(Boolean);
  for (const tok of [toks.at(-1), centred?.[1], bare(head)[0], bare(tail).at(-1)]) {
    if (!tok || tok.length > 12) continue;
    const p = parsePrintedToken(tok);
    if (p && (p.numbering === 'roman' || p.numbering === 'folio')) return p;
  }
  return null;
}

/** frames: [{ i, marker }], i = index in the reader's list, marker = frameMarker() or null. */
export function findRuns(frames) {
  const markers = frames.filter(f => f.marker && f.marker.value > 0);
  const runs = [];
  for (const fam of ['num', 'roman', 'folio']) {
    const ms = markers.filter(f => family(f.marker.numbering) === fam);
    const lines = new Map();
    for (const f of ms) {
      const q = position(f.marker);
      for (const dir of [1, -1]) {
        const k = `${dir}:${q - dir * f.i}`;
        if (!lines.has(k)) lines.set(k, { dir, offset: q - dir * f.i, anchors: [] });
        lines.get(k).anchors.push(f.i);
      }
    }
    const segs = [];
    for (const line of lines.values()) {
      if (line.anchors.length < MIN_ANCHORS) continue;
      const as = line.anchors.sort((a, b) => a - b);
      let cur = [as[0]];
      const push = () => { if (cur.length >= MIN_ANCHORS) segs.push({ family: fam, dir: line.dir, offset: line.offset, anchors: cur }); };
      for (const a of as.slice(1)) {
        if (a - cur.at(-1) > MAX_ANCHOR_GAP) { push(); cur = [a]; } else cur.push(a);
      }
      push();
    }
    runs.push(...segs);
  }
  // Longest first. A shorter line inside a longer one interrupts it: the numbers change there, so
  // the longer run stops either side rather than running through. Numbering restarts and plates read so.
  runs.sort((a, b) => b.anchors.length - a.anchors.length);
  const kept = [];
  for (const seg of runs) {
    let anchors = seg.anchors;
    for (const k of kept) anchors = anchors.filter(a => a < k.anchors[0] || a > k.anchors.at(-1));
    if (anchors.length < MIN_ANCHORS) continue;
    const first = anchors[0], last = anchors.at(-1);
    const split = [];
    for (let j = kept.length - 1; j >= 0; j--) {
      const k = kept[j];
      if (k.anchors[0] < first && k.anchors.at(-1) > last) {
        kept.splice(j, 1);
        split.push({ ...k, anchors: k.anchors.filter(a => a < first) }, { ...k, anchors: k.anchors.filter(a => a > last) });
      }
    }
    // `anchors` was computed against kept runs before any split, so a split run's parts are clear of it.
    const piece = { ...seg, anchors: anchors.filter((a, x) => x === 0 || a - anchors[x - 1] <= MAX_ANCHOR_GAP) };
    if (piece.anchors.length >= MIN_ANCHORS) kept.push(piece);
    for (const s of split) if (s.anchors.length >= MIN_ANCHORS) kept.push(s);
  }
  const byI = new Map(frames.map(f => [f.i, f]));
  return kept
    .map(r => {
      const first = r.anchors[0], last = r.anchors.at(-1);
      let seen = 0;
      for (let i = first; i <= last; i++) { const f = byI.get(i); if (f?.marker && family(f.marker.numbering) === r.family) seen++; }
      return { family: r.family, dir: r.dir, offset: r.offset, first, last, anchors: r.anchors, agree_share: r.anchors.length / (seen || 1) };
    })
    .filter(r => r.agree_share >= MIN_AGREE_SHARE && expectedAt(r, r.first) !== null && expectedAt(r, r.last) !== null)
    .sort((a, b) => a.first - b.first);
}

/** What the line says frame i carries. Returns { value, side? }, or null where it would fall below 1. */
export function expectedAt(run, i) {
  const q = run.dir * i + run.offset;
  if (run.family === 'folio') {
    const value = Math.floor(q / 2);
    return value >= 1 ? { value, versoSide: q % 2 === 1 } : null;
  }
  return q >= 1 ? { value: q } : null;
}

/**
 * The frames to open for one run: both ends and the middle, all anchors, and one frame no marker was
 * read from, because the stretches between anchors are what the map asserts without having seen.
 */
export function checkpoints(run, frames) {
  const byI = new Map(frames.map(f => [f.i, f]));
  const mid = (run.first + run.last) / 2;
  const middle = run.anchors.reduce((best, a) => (Math.abs(a - mid) < Math.abs(best - mid) ? a : best), run.anchors[0]);
  const points = [{ i: run.first, role: 'end' }, { i: middle, role: 'middle' }, { i: run.last, role: 'end' }];
  const anchors = new Set(run.anchors);
  let between = null;
  for (let i = run.first + 1; i < run.last; i++) {
    const f = byI.get(i);
    if (anchors.has(i) || !f || f.page_type === 'blank') continue;
    if (between === null || Math.abs(i - mid) < Math.abs(between - mid)) between = i;
  }
  if (between !== null && between !== middle) points.push({ i: between, role: 'between' });
  return points;
}

const sameSide = (exp, parsed) => (parsed.side === 'v' || parsed.side === 'b') === exp.versoSide;
const matches = (run, i, parsed) => {
  const exp = expectedAt(run, i);
  if (!exp || !parsed || parsed.value !== exp.value) return false;
  if (family(parsed.numbering) !== run.family) return false;
  return run.family !== 'folio' || sameSide(exp, parsed);
};

/** Does this read hold the number the line says frame i carries? */
export function readAgrees(run, i, printed) { return matches(run, i, parsePrintedToken(printed)); }

/**
 * Decide a run from blind reads: reads = [{ i, role, printed }], printed = what the reader saw, or null
 * if the image shows no number. Any number that is not what the line says rejects the whole run: a
 * shifted line is not a smaller map. An anchor that shows no number (a marker the OCR invented, a
 * chapter opening) is not evidence, so an end with nothing printed moves inward to the first anchor
 * that shows its number. What is left needs three matching anchors: both ends and one between.
 *
 * A frame between anchors may show no number, but a run whose anchors all sit on one side of the
 * opening proves nothing about the other side (Maqrizi, #5699: 353, 352, 355, 354, with only the odd
 * frames read). So numbers fill the gaps only where the anchors cover both sides, or a frame between
 * anchors was seen to agree; otherwise `interpolate` is false and only the anchors themselves get a number.
 *
 * Returns { confirmed, reason, first, last, interpolate, numbering, form }. The numeral system comes
 * from the images, not the OCR.
 */
export function judgeRun(run, reads) {
  const anchors = new Set(run.anchors);
  const numeric = [];
  for (const r of reads) {
    if (r.printed == null) continue;
    const parsed = parsePrintedToken(r.printed);
    if (!matches(run, r.i, parsed)) {
      const exp = expectedAt(run, r.i);
      return { confirmed: false, reason: `${r.role} frame ${r.i}: expected ${exp?.value ?? 'none'}, image shows ${r.printed}` };
    }
    numeric.push({ ...r, parsed });
  }
  const seen = numeric.filter(r => anchors.has(r.i)).sort((a, b) => a.i - b.i);
  if (seen.length < 3) return { confirmed: false, reason: `${seen.length} anchors show their number, three needed` };
  const first = seen[0].i, last = seen.at(-1).i;
  const trimmed = run.anchors.filter(a => a >= first && a <= last);
  if (trimmed.length < MIN_ANCHORS) return { confirmed: false, reason: `${trimmed.length} anchors left after trimming unnumbered ends` };
  let hasGap = false;
  for (let i = first; i <= last; i++) if (!anchors.has(i)) hasGap = true;
  const odd = trimmed.filter(a => a % 2 === 1).length;
  const bothSides = Math.min(odd, trimmed.length - odd) >= 0.2 * trimmed.length;
  const interpolate = !hasGap || bothSides || numeric.some(r => !anchors.has(r.i) && r.i > first && r.i < last);
  const count = {};
  for (const { parsed: p } of seen) count[`${p.numbering}|${p.form ?? ''}`] = (count[`${p.numbering}|${p.form ?? ''}`] || 0) + 1;
  const [numbering, form] = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0].split('|');
  return { confirmed: true, reason: 'ends and middle match', first, last, interpolate, numbering, form: form || undefined };
}

/** The rows of a confirmed run, one per frame it vouches for. pages[i].id is the key. */
export function rowsForRun(run, verdict, pages, { book_id, run_id, method, confirmed_at }) {
  const anchors = new Set(run.anchors);
  const rows = [];
  for (let i = verdict.first; i <= verdict.last; i++) {
    const exp = expectedAt(run, i);
    const page = pages[i];
    if (!exp || !page?.id || (!anchors.has(i) && !verdict.interpolate)) continue;
    const side = run.family === 'folio' ? (verdict.form === 'ab' ? (exp.versoSide ? 'b' : 'a') : (exp.versoSide ? 'v' : 'r')) : undefined;
    rows.push({
      page_id: page.id, book_id,
      label: labelFor(exp.value, verdict.numbering, { side, form: verdict.form }),
      value: exp.value,
      numbering: verdict.numbering,
      ...(side ? { side } : {}),
      source: anchors.has(i) ? 'read' : 'interpolated',
      run_id, method, confirmed_at,
    });
  }
  return rows;
}

/**
 * Second look at a run the first reads left open: more anchors inward of an end that showed nothing, and
 * frames between anchors spread through the run, on the side of the opening the anchors do not cover.
 */
export function moreCheckpoints(run, frames, reads) {
  const byI = new Map(frames.map(f => [f.i, f]));
  const anchors = new Set(run.anchors);
  const opened = new Set(reads.map(r => r.i));
  const points = [];
  const blanks = reads.filter(r => r.printed == null && anchors.has(r.i));
  if (blanks.length) {
    const fresh = run.anchors.filter(a => !opened.has(a));
    for (const a of [...fresh.slice(0, 2), ...fresh.slice(-2), ...fresh.slice(Math.floor(fresh.length / 2), Math.floor(fresh.length / 2) + 2)]) {
      if (!points.some(p => p.i === a)) points.push({ i: a, role: 'end' });
    }
  }
  const odd = run.anchors.filter(a => a % 2 === 1).length;
  const minority = odd * 2 > run.anchors.length ? 0 : 1;
  for (const at of [0.25, 0.75]) {
    const want = run.first + (run.last - run.first) * at;
    let best = null;
    for (let i = run.first + 1; i < run.last; i++) {
      const f = byI.get(i);
      if (anchors.has(i) || opened.has(i) || !f || f.page_type === 'blank' || i % 2 !== minority) continue;
      if (best === null || Math.abs(i - want) < Math.abs(best - want)) best = i;
    }
    if (best !== null && !points.some(p => p.i === best)) points.push({ i: best, role: 'between' });
  }
  return points;
}

/** A book's pages → frames for findRuns: the reader's order, index in that list as the position. */
export function framesOf(pages) {
  return pages.map((p, i) => ({ i, page_type: p.page_type, marker: frameMarker(p.head, p.tail) }));
}
