// PRIOR ART: scripts/audit/translation-leaf-shift.mjs (#5021, PR #6683) — this is its classifier,
// moved here unchanged so the block translation lanes can run it at write time; the audit imports
// it back. scripts/lib/block-drift.mjs catches a CLAUSE moved across one boundary by letter case;
// it cannot see a whole leaf shifted, which is what this reads, from the numbers a leaf prints.
/**
 * leaf-shift — is a page's English the NEXT or PREVIOUS leaf's text? Pure functions, no I/O.
 * The method, its controls and its limits are documented in scripts/audit/translation-leaf-shift.mjs.
 */
import { stripMarkupTags } from './strip-markup-tags.mjs';

export const MIN_VALUE = 10;
export const BRACKET_MIN = 100;
export const MAX_VALUE = 99999;
export const MIN_RUN = 2;
export const HEAD_LINE_MAX = 90;
export const STRONG_MIN = 30;

// Zero code point of each decimal-digit block we expect in the corpus.
const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66,
  0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90,
  0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10,
];
const DIGIT_MAP = new Map();
for (const z of DIGIT_ZEROS) for (let d = 0; d < 10; d++) DIGIT_MAP.set(String.fromCodePoint(z + d), String(d));
const NON_ASCII_DIGIT = new RegExp(`[${[...DIGIT_MAP.keys()].join('')}]`, 'gu');
/** Digits of any numeral system → ASCII digits. */
export const foldDigits = s => String(s || '').replace(NON_ASCII_DIGIT, ch => DIGIT_MAP.get(ch));

const CJK_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CJK_UNIT = { 十: 10, 百: 100, 千: 1000 };
/** 一百七十三 → 173, 廿三 → 23, 一七三 → 173. null when the run is not a number. */
export function cjkNumber(run) {
  const s = run.replace(/廿/g, '二十').replace(/卅/g, '三十');
  if (![...s].some(ch => ch in CJK_UNIT)) {
    if ([...s].length < 2) return null;
    return Number([...s].map(ch => CJK_DIGIT[ch]).join(''));
  }
  let total = 0;
  let cur = null;
  for (const ch of s) {
    if (ch in CJK_DIGIT) cur = CJK_DIGIT[ch];
    else {
      total += (cur ?? 1) * CJK_UNIT[ch];
      cur = null;
    }
  }
  return total + (cur ?? 0);
}

const ROMAN_RE = /(?<![\p{L}\p{N}])(?=[MDCLXVI]{3,})M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})(?![\p{L}\p{N}])/gu;
const ROMAN_VAL = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const ROMAN_WORDS = new Set(['MIX', 'DIV', 'CIV', 'LIV', 'VIM', 'DIM', 'MID', 'LID', 'DID', 'MIL', 'CCC', 'MMM', 'XXX', 'III']);
function romanValue(s) {
  let v = 0;
  for (let i = 0; i < s.length; i++) {
    const a = ROMAN_VAL[s[i]];
    const b = ROMAN_VAL[s[i + 1]] || 0;
    v += a < b ? -a : a;
  }
  return v;
}

export const META_TAGS = 'scan-quality|language|script|page-type|columns|detected-images|vocab|warning|meta|image-desc|figure|summary|keywords';
export const HEAD_TAGS = 'page-num|header|sig|footer|catchword';
export const tagBlock = names => new RegExp(`<(${names})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi');

/**
 * Split a layer into its running head and its body. The head is the <page-num>/<header>/<sig>
 * tags plus a short first line that carries a number (an untagged running head, as on the
 * shifted Śakuntalā pages: "277 || Act VII || 299").
 */
export function splitLayer(text) {
  let s = String(text || '').replace(tagBlock(META_TAGS), ' ');
  const head = [];
  s = s.replace(tagBlock(HEAD_TAGS), (_, __, inner) => {
    head.push(inner);
    return '\n';
  });
  s = stripMarkupTags(s, ' ');
  const lines = s.split('\n');
  const first = lines.findIndex(l => l.trim());
  if (first >= 0) {
    const l = lines[first].trim();
    const f = foldDigits(l).replace(/[*#>_~\s]+/g, ' ').trim();
    // A running head opens or closes on a bare number; a verse line closes on ॥N॥ and is body.
    if (f.length <= HEAD_LINE_MAX && (/^[-–—|\s]*\d+(?!\d)/.test(f) || /\d[\s.|-]*$/.test(f))) {
      head.push(l);
      lines[first] = '';
    }
  }
  return { head: head.join('\n'), body: lines.join('\n') };
}

/** Every number in a text, as a Set of integers within [MIN_VALUE, MAX_VALUE]. */
export function numbersIn(text, { brackets = true } = {}) {
  const out = new Set();
  const s = foldDigits(text);
  for (const m of s.matchAll(/\d+/g)) {
    const v = Number(m[0]);
    if (v < MIN_VALUE || v > MAX_VALUE || m[0].length > 5) continue;
    if (brackets && v < BRACKET_MIN) {
      const before = s.slice(Math.max(0, m.index - 2), m.index).trimEnd().slice(-1);
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 2).trimStart()[0];
      if (/[([{（【〔]/.test(before || '') || /[)\]}）】〕]/.test(after || '')) continue;
    }
    out.add(v);
  }
  for (const m of s.matchAll(/[〇零一二兩两三四五六七八九十百千廿卅]{2,}/gu)) {
    const v = cjkNumber(m[0]);
    if (v != null && Number.isFinite(v) && v >= MIN_VALUE && v <= MAX_VALUE) out.add(v);
  }
  for (const m of s.matchAll(ROMAN_RE)) {
    if (!m[0] || ROMAN_WORDS.has(m[0])) continue;
    const v = romanValue(m[0]);
    if (v >= MIN_VALUE && v <= MAX_VALUE) out.add(v);
  }
  return out;
}

const EMPTY = new Set();
const votes = (eng, own, a, b) => [...eng].filter(n => own.has(n) && !a.has(n) && !b.has(n));

/**
 * Classify each page of one book.
 * @param {{page_number:number, ocr:string, tr:string, pv?:string}[]} pages  sorted by page_number
 */
export function classifyBook(pages) {
  const rows = pages.map(p => {
    const o = splitLayer(p.ocr);
    const t = splitLayer(p.tr);
    return {
      page_number: p.page_number,
      pv: p.pv ?? null,
      translated: !!(p.tr && p.tr.trim()),
      oBody: numbersIn(o.body),
      oHead: numbersIn(o.head, { brackets: false }),
      tBody: numbersIn(t.body),
      tHead: numbersIn(t.head, { brackets: false }),
    };
  });
  const byPn = new Map(rows.map(r => [r.page_number, r]));
  for (const r of rows) {
    const P = byPn.get(r.page_number - 1);
    const N = byPn.get(r.page_number + 1);
    const cls = (eng, own, prev, next, drop = EMPTY) => {
      const e = new Set([...eng].filter(n => !drop.has(n)));
      const v = { own: votes(e, own, prev, next), next: votes(e, next, own, prev), prev: votes(e, prev, own, next) };
      let c = 'none';
      if (v.own.length + v.next.length + v.prev.length) {
        if (v.next.length && !v.own.length && !v.prev.length) c = 'next';
        else if (v.prev.length && !v.own.length && !v.next.length) c = 'prev';
        else if (v.own.length && !v.next.length && !v.prev.length) c = 'own';
        else c = 'mixed';
      }
      return { c, v };
    };
    if (!r.translated) {
      r.cls = 'untranslated';
      r.hdr = 'untranslated';
      continue;
    }
    // The body verdict ignores every number that is in a running head of N, N-1 or N+1.
    const heads = new Set([...r.oHead, ...r.tHead, ...(P?.oHead || []), ...(N?.oHead || [])]);
    const b = cls(r.tBody, r.oBody, P?.oBody || EMPTY, N?.oBody || EMPTY, heads);
    r.cls = b.c;
    r.votes = b.v;
    // Own numbers the transcription prints and the English lacks: a shifted page loses them.
    r.ownMissing = [...r.oBody].filter(n => !heads.has(n) && !r.tBody.has(n) && !(P?.oBody || EMPTY).has(n) && !(N?.oBody || EMPTY).has(n)).length;
    r.hdr = cls(r.tHead, r.oHead, P?.oHead || EMPTY, N?.oHead || EMPTY).c;
  }
  const runs = [];
  for (const dir of ['next', 'prev']) {
    let run = [];
    const flush = () => {
      if (run.length >= MIN_RUN) runs.push({ dir, start: run[0].page_number, end: run[run.length - 1].page_number, length: run.length, pv: [...new Set(run.map(r => r.pv))], strong: run.every(r => r.ownMissing >= 1 && Math.max(...r.votes[dir]) >= STRONG_MIN), pages: run.map(r => ({ p: r.page_number, n: r.votes[dir], ownMissing: r.ownMissing })) });
      run = [];
    };
    for (const r of rows) {
      if (r.cls === dir && (!run.length || run[run.length - 1].page_number === r.page_number - 1)) run.push(r);
      else {
        flush();
        if (r.cls === dir) run.push(r);
      }
    }
    flush();
  }
  const count = key => rows.reduce((a, r) => ((a[r[key]] = (a[r[key]] || 0) + 1), a), {});
  return { rows, runs, classes: count('cls'), hdrClasses: count('hdr') };
}

/**
 * The write-time gate (#5021): does a parsed block carry a run of ≥ MIN_RUN consecutive pages whose
 * English votes only for the NEXT (or only the PREVIOUS) leaf's printed numbers? `pages` in block
 * order (page_number, ocr.data); `translations` the parser's Map<page_number, text>. Returns the
 * runs, empty when the block is clean or casts no vote. The block's first and last pages have one
 * neighbour missing, so a run there is seen only from its inner pages.
 *
 * A block translator that shifted by one leaf keeps each page's running head and writes the next
 * leaf's body (Śakuntalā pp.291-294; De Fato Declinando p.30 on prompt v13, 2026-10-05), so a
 * block that comes back complete passes every length and parse check. This reads the body.
 */
export function blockLeafShiftRuns(pages, translations) {
  const rows = pages.map(p => ({ page_number: p.page_number, ocr: p.ocr?.data || '', tr: translations.get(p.page_number) || '' }));
  return classifyBook(rows).runs;
}
