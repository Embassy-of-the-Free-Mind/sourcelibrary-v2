#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/detect-translation-misalignment.mjs — compares the PRINTED page
// number tag in both layers; it needs <page-num> in the English (1 of 385 pages on Śakuntalā) and
// the block translator kept the right running head while moving the body, so it is blind to this
// shape by construction. scripts/lib/block-drift.mjs + scripts/audit/translation-page-boundary.mjs
// (#5021/#5031/#3918) — a CLAUSE moved across one boundary, tested by letter case; caseless
// scripts make no claim, and its anchorsNext looks only at the page edge. scripts/lib/text-shift.mjs
// is the repair transform for OCR shifts, not a detector. None reads the numbers a leaf prints in
// its BODY (verse numbers, footnote keys) in any numeral system, which is the only signal a
// Devanagari, Tibetan or Arabic page offers without a model.
/**
 * translation-leaf-shift — is a page's English the NEXT or PREVIOUS leaf's text? (#5021, #6672)
 * $0 and read-only: Mongo reads, no model, no writes.
 *
 * The shape (Śakuntalā 69dea23c4d19ec2e9ba75f5e pp.291-295, found by a volunteer run, #6418):
 * the 8-page block translator wrote each page's own running head and then the body of the
 * following leaf. Every text is healthy English; it is on the wrong page.
 *
 * Signal: numbers. Per page, the numbers in the body of the transcription (verse numbers such as
 * ॥१७३॥, "Verse 173." footnote keys, section and line numbers, years, cross-references; digits of
 * every Unicode numeral system, CJK numerals, upper-case Roman numerals) against the numbers in
 * the body of the English. A number in page N's English votes
 *   own   it is in N's transcription and in neither neighbour's
 *   next  it is in N+1's transcription, not in N's and not in N-1's
 *   prev  it is in N-1's transcription, not in N's and not in N+1's
 * and otherwise says nothing (shared with a neighbour, or in none of the three).
 * Left out: numbers below MIN_VALUE (footnote keys 1-9 are on every page); bracketed numbers
 * below BRACKET_MIN ("(12)", "[3]": list items and editorial counters, the false hits on
 * Śakuntalā p.360); the running head and the printed page number of both layers — the block
 * translator kept those right, so they vote "own" on a shifted page. The head is reported as a
 * second, separate class (hdr), never mixed into the verdict.
 *
 * Page class: next (next ≥ 1, own = 0, prev = 0), prev (mirror), own (own ≥ 1, no neighbour
 * vote), mixed (anything else with a vote), none (no vote: NO CLAIM, not "aligned").
 * A book is FLAGGED when ≥ MIN_RUN consecutive page_numbers are all `next` or all `prev`.
 * A single `next` page is a boundary drift candidate (#5021's class), not a whole-page shift.
 * Tier A: some run where EVERY page also lacks at least one of its own body numbers (ownMissing)
 * and votes with a number ≥ STRONG_MIN — the small sequential numbers (10, 11, 12) that lists
 * and verse counts repeat on every other page cannot make a tier-A run. Tier B: the rest.
 *
 * MEASURED 2026-10-13 (#5021), scripts/eval/experiments/2026-10-13-translation-leaf-shift-5021.md:
 *   control    Śakuntalā as of 2026-10-13T00:00Z: one run, pp.291-294, each page voting the next
 *              leaf's verse number (171-174), head class `own`. Live text: no run.
 *   by eye     20 flagged books, one page each, scan opened: 12 carry the neighbour's English
 *              (tier A 8/10, tier B 4/10). The four tier-B flags on single-page-lane (v2) text,
 *              which cannot move a page, were all false: tier B is a noise floor there.
 *   coverage   84% of translated pages in caseless-label books cast no vote (Tibetan 99%), and
 *              3,862 of 5,903 such books have no testable pair. No flag is NOT "aligned".
 * A flag is a work list; open the scan before acting on it (measurement-instruments.md).
 *
 * Usage (node --env-file=.env.production.local):
 *   --book <id> [--as-of <ISO>] [--list]   one book; --as-of rebuilds the English as it stood
 *                                          at that time from page_revisions snapshots
 *   --frame caseless                       every translated book whose language label is a
 *                                          caseless script
 *   --frame rest --sample 300 [--seed 5021]  seeded draw from the other translated books
 *   --out <dir>   checkpoint file <dir>/<frame>.jsonl, one line per book, resumed on re-run
 *   --self-test   assertions on the extractor, no database
 */
import fs from 'node:fs';
import path from 'node:path';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';

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

const META_TAGS = 'scan-quality|language|script|page-type|columns|detected-images|vocab|warning|meta|image-desc|figure|summary|keywords';
const HEAD_TAGS = 'page-num|header|sig|footer|catchword';
const tagBlock = names => new RegExp(`<(${names})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi');

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

/** Dominant script of a book's transcription: 'caseless' when most letters have no case. */
export function scriptOf(sample) {
  const s = stripMarkupTags(String(sample || '').replace(tagBlock(`${META_TAGS}|${HEAD_TAGS}`), ' '), ' ');
  const cased = (s.match(/[\p{Lu}\p{Ll}]/gu) || []).length;
  const caseless = (s.match(/\p{Lo}/gu) || []).length;
  const by = {};
  for (const [name, re] of Object.entries({
    Devanagari: /\p{Script=Devanagari}/gu, Tibetan: /\p{Script=Tibetan}/gu, Han: /\p{Script=Han}/gu, Arabic: /\p{Script=Arabic}/gu,
    Hebrew: /\p{Script=Hebrew}/gu, Syriac: /\p{Script=Syriac}/gu, Hangul: /\p{Script=Hangul}/gu, Kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu,
    Latin: /\p{Script=Latin}/gu, Greek: /\p{Script=Greek}/gu, Cyrillic: /\p{Script=Cyrillic}/gu,
  })) by[name] = (s.match(re) || []).length;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  const letters = cased + caseless;
  return { caselessShare: letters ? caseless / letters : null, script: top && top[1] > 0 ? (top[0] === 'Kana' || (top[0] === 'Han' && by.Kana > by.Han * 0.15) ? 'Japanese' : top[0]) : 'none' };
}

export const CASELESS_LABEL = /chinese|tibetan|sanskrit|pali\b|prakrit|hindi|marathi|bengali|nepali|^ne$|tamil|telugu|kannada|malayalam|gujarati|punjabi|sinhal|burmese|thai\b|khmer|lao\b|japanese|korean|arabic|persian|farsi|urdu|ottoman|hebrew|aramaic|yiddish|ladino|syriac|samaritan|mandaic|ge'?ez|ethiopic|amharic|georgian|mongol|manchu|sumerian|akkadian|egyptian|demotic|hieroglyph|avestan|pahlavi|sogdian|uyghur/i;

function selfTest() {
  const eq = (a, b, what) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`self-test: ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };
  eq(foldDigits('॥१७३॥ ٤٢ ༡༢ １２'), '॥173॥ 42 12 12', 'foldDigits');
  eq(cjkNumber('一百七十三'), 173, 'cjk units');
  eq(cjkNumber('廿三'), 23, 'cjk 廿');
  eq(cjkNumber('一七三'), 173, 'cjk positional');
  eq([...numbersIn('Verse 173. See (12) and [45], p. 275; CLXXIV; MIX; 7')].sort((a, b) => a - b), [173, 174, 275], 'numbersIn');
  const mk = (n, own, eng) => ({ page_number: n, ocr: `<page-num>${n + 100}</page-num>\n\nपाठः ॥${own}॥\n\nVerse ${own}. note`, tr: `${n + 100} || Act VII ||\n\nText.\n\n<note>Verse ${eng}</note>` });
  const shifted = classifyBook([mk(1, 170, 170), mk(2, 171, 172), mk(3, 172, 173), mk(4, 173, 174), mk(5, 174, 174)]);
  eq(shifted.rows.map(r => r.cls), ['own', 'next', 'next', 'next', 'own'], 'shifted classes');
  eq(shifted.runs.map(r => [r.dir, r.start, r.end]), [['next', 2, 4]], 'shifted run');
  eq(classifyBook([mk(1, 170, 170), mk(2, 171, 171), mk(3, 172, 172)]).runs, [], 'aligned book');
  console.log('self-test ok');
}

// ---------------------------------------------------------------------------------------------
async function loadBook(db, bookId, asOf) {
  const pages = await db.collection('pages')
    .find({ book_id: bookId }, { projection: { page_number: 1, id: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.prompt_version': 1, 'translation.updated_at': 1, 'translation.model': 1 } })
    .sort({ page_number: 1 }).toArray();
  let restored = 0;
  if (asOf) {
    const ids = pages.map(p => p.id || String(p._id));
    const revs = await db.collection('page_revisions')
      .find({ page_id: { $in: ids }, field: 'translation', created_at: { $gt: asOf } }, { projection: { page_id: 1, data: 1, prompt_version: 1, created_at: 1 } })
      .sort({ created_at: 1 }).toArray();
    const firstAfter = new Map();
    for (const r of revs) if (!firstAfter.has(r.page_id)) firstAfter.set(r.page_id, r);
    for (const p of pages) {
      const r = firstAfter.get(p.id || String(p._id));
      // A revision row holds the value it REPLACED, so the first one after as-of is the text as-of.
      if (r && typeof r.data === 'string') {
        p.translation = { data: r.data, prompt_version: r.prompt_version };
        restored++;
      }
    }
  }
  return {
    restored,
    pages: pages.map(p => ({ page_number: p.page_number, ocr: p.ocr?.data || '', tr: p.translation?.data || '', pv: p.translation?.prompt_version != null ? String(p.translation.prompt_version).replace(/^v/i, '') : null })),
  };
}

function summarise(book, loaded) {
  const { pages } = loaded;
  const res = classifyBook(pages);
  const translated = res.rows.filter(r => r.translated);
  const pvCount = {};
  for (const r of translated) pvCount[r.pv ?? 'none'] = (pvCount[r.pv ?? 'none'] || 0) + 1;
  const sc = scriptOf(pages.filter(p => p.tr).slice(0, 400).map(p => p.ocr.slice(0, 1500)).join('\n'));
  return {
    book_id: book.id || String(book._id),
    title: String(book.title || '').slice(0, 90),
    language: book.language ?? null,
    script: sc.script,
    caselessShare: sc.caselessShare == null ? null : Math.round(sc.caselessShare * 1000) / 1000,
    visible: !!book.visible,
    pages: pages.length,
    translated: translated.length,
    pv: pvCount,
    blockEra: (pvCount['10'] || 0) + (pvCount['11'] || 0),
    classes: res.classes,
    hdrClasses: res.hdrClasses,
    signal: translated.filter(r => r.cls !== 'none').length,
    // Consecutive translated pages that BOTH vote: the only places a run could have been seen.
    pairs: res.rows.filter((r, i) => i > 0 && r.translated && r.cls !== 'none' && res.rows[i - 1].translated && res.rows[i - 1].cls !== 'none' && res.rows[i - 1].page_number === r.page_number - 1).length,
    singles: { next: res.rows.filter(r => r.cls === 'next').length, prev: res.rows.filter(r => r.cls === 'prev').length },
    runs: res.runs,
    flagged: res.runs.length > 0,
    tier: !res.runs.length ? null : res.runs.some(x => x.strong) ? 'A' : 'B',
    ...(loaded.restored ? { restored: loaded.restored } : {}),
  };
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, dflt = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
  };
  if (argv.includes('--self-test')) return selfTest();
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set: node --env-file=.env.production.local …');
  const { MongoClient, ObjectId } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred', maxPoolSize: 6, compressors: ['zlib'] });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  try {
    const BOOK = arg('--book');
    if (BOOK) {
      const or = [{ id: BOOK }];
      if (/^[0-9a-f]{24}$/i.test(BOOK)) or.push({ _id: new ObjectId(BOOK) });
      const book = await db.collection('books').findOne({ $or: or }, { projection: { id: 1, title: 1, language: 1, visible: 1 } });
      if (!book) throw new Error(`no book ${BOOK} by id or _id`);
      const asOf = arg('--as-of') ? new Date(arg('--as-of')) : null;
      const loaded = await loadBook(db, book.id || String(book._id), asOf);
      const s = summarise(book, loaded);
      console.log(JSON.stringify(s, null, 2));
      if (argv.includes('--list')) {
        for (const r of classifyBook(loaded.pages).rows) {
          if (r.cls === 'none' || r.cls === 'untranslated' || r.cls === 'own') continue;
          console.log(`p.${r.page_number}\t${r.cls}\thdr=${r.hdr}\town=${r.votes.own.join(',')}\tnext=${r.votes.next.join(',')}\tprev=${r.votes.prev.join(',')}\townMissing=${r.ownMissing}`);
        }
      }
      return;
    }

    const FRAME = arg('--frame');
    if (!['caseless', 'rest'].includes(FRAME)) throw new Error('give --book <id>, --frame caseless, --frame rest, or --self-test');
    const OUT = arg('--out', 'scripts/output/translation-leaf-shift');
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${FRAME}.jsonl`);
    const all = await db.collection('books')
      .find({ pages_translated: { $gt: 0 } }, { projection: { id: 1, title: 1, language: 1, visible: 1, pages_translated: 1 } })
      .sort({ _id: 1 }).toArray();
    const isCaseless = b => CASELESS_LABEL.test(String(b.language || ''));
    let books = all.filter(b => (FRAME === 'caseless' ? isCaseless(b) : !isCaseless(b)));
    const frameSize = books.length;
    if (FRAME === 'rest') {
      const n = Number(arg('--sample', '300'));
      const rnd = mulberry32(Number(arg('--seed', '5021')));
      for (let i = books.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [books[i], books[j]] = [books[j], books[i]];
      }
      books = books.slice(0, n);
    }
    const done = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).book_id) : []);
    console.error(`${FRAME}: frame ${frameSize} books, ${books.length} to scan, ${done.size} already in ${file}`);
    const queue = books.filter(b => !done.has(b.id || String(b._id)));
    let n = 0;
    const worker = async () => {
      for (let b = queue.shift(); b; b = queue.shift()) {
        try {
          const s = summarise(b, await loadBook(db, b.id || String(b._id), null));
          fs.appendFileSync(file, JSON.stringify(s) + '\n');
        } catch (e) {
          fs.appendFileSync(path.join(OUT, `${FRAME}.errors.log`), `${b.id || b._id}\t${e.message}\n`);
        }
        if (++n % 100 === 0) console.error(`  ${n}/${queue.length + n}`);
      }
    };
    await Promise.all(Array.from({ length: Number(arg('--concurrency', '4')) }, worker));
    console.error(`DONE ${FRAME}: ${n} scanned this run`);
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
