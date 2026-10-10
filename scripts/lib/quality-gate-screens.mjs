// PRIOR ART: /root/translate-next/s1-screen.mjs (Hetzner, translate-next-5467 STEP 1, not in the repo) —
// the four screens over all 36,916 translate-300 pages, ported here with its thresholds; the loop test
// now also asks scripts/lib/ocr-loop-guard.mjs `loopVerdict` (the write-time OCR loop guard), the
// language test uses english-source-detect.mjs `englishFraction`, and "collapsed" uses the thresholds of
// translate-batch-chained.mjs `looksCollapsed` (not imported: that module pulls the Batch client in).
// scripts/lib/page-integrity.mjs runs corpus detectors over a BOOK's pages (truncation, duplicate scan,
// echo, page-number breaks, catchwords) — a different question; these screen one page each, $0.
//
// quality-gate-screens — the mechanical half of the standing quality gate (#5826): pure screens run over
// EVERY page of a gate window, beside the by-eye read of 30 pages. They cost nothing and catch only the
// mechanical failures: empty, collapsed, looping, wrong output language, length-ratio outliers. A flag
// is a page to look at, not a verdict: on translate-300, 330 "wrong language" flags were all catalogues
// that keep headwords in the original, by house convention.

import { transcriptionBody } from './blank-page-guard.mjs';
import { loopVerdict } from './ocr-loop-guard.mjs';
import { englishFraction } from './english-source-detect.mjs';
import { makeRng } from '../eval/lib/paired-stats.mjs';

export const SCREEN_FLAGS = Object.freeze(['empty', 'collapsed', 'loop-ocr', 'loop-translation', 'wrong-lang', 'ratio']);

const CJK = /chinese|japanese|korean|tibetan|thai|lao|burmese|khmer|manchu|mongol/i;
// translate-batch-chained.mjs COLLAPSE_OCR_FLOOR / COLLAPSE_BODY_CAP.
const COLLAPSE_OCR_FLOOR = 800;
const COLLAPSE_BODY_CAP = 300;

const body = (t) => transcriptionBody(t || '');

/** Share of word 6-shingles that occur 3+ times (s1-screen's block-repeat measure; needs ≥ 60 words). */
export function shingleRepeatShare(text) {
  const words = String(text || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
  if (words.length < 60) return 0;
  const seen = new Map();
  for (let i = 0; i + 6 <= words.length; i++) {
    const k = words.slice(i, i + 6).join(' ');
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  let rep = 0;
  for (const v of seen.values()) if (v > 2) rep += v;
  return rep / (words.length - 5);
}

const loops = (text) => {
  const v = loopVerdict(text);
  return v.refuse || shingleRepeatShare(body(text)) > 0.3;
};

const nonLatinShare = (t) => (t.length ? (t.match(/[^\x00-\x7FÀ-ɏ -⁯]/g) || []).length / t.length : 0);

/**
 * Screen one translated page. `language` is the book's. Returns { ol, tl, ratio, en, flags[] }.
 * Thresholds are s1-screen's, which were checked by eye on translate-300.
 */
export function screenTranslatedPage({ ocr, translation, language }) {
  const o = body(ocr), t = body(translation);
  const flags = [];
  if (o.length >= 40 && t.length < 10) flags.push('empty');
  else if ((ocr || '').length > COLLAPSE_OCR_FLOOR && t.length < COLLAPSE_BODY_CAP) flags.push('collapsed');
  if (loops(ocr)) flags.push('loop-ocr');
  if (loops(translation)) flags.push('loop-translation');
  const en = englishFraction(t);
  if (t.length >= 200 && ((en != null && en < 0.08) || nonLatinShare(t) > 0.3)) flags.push('wrong-lang');
  const ratio = o.length ? t.length / o.length : null;
  if (o.length >= 200 && ratio != null) {
    const [lo, hi] = CJK.test(language || '') ? [0.4, 10] : [0.35, 3.5];
    if (ratio < lo || ratio > hi) flags.push('ratio');
  }
  return { ol: o.length, tl: t.length, ratio: ratio == null ? null : +ratio.toFixed(2), en: en == null ? null : +en.toFixed(3), flags };
}

/**
 * Screen one OCR'd page. `bookMedian` = median OCR body length of the book's pages in the window.
 * wrong-lang here = a non-English book whose OCR reads as English prose (a translation or a page
 * description stored as the transcription, taxonomy O15/T17); ratio = under a tenth or over five times
 * the book's median.
 */
export function screenOcrPage({ ocr, language, bookMedian = null }) {
  const o = body(ocr);
  const flags = [];
  if (o.length < 10) flags.push('empty');
  if (loops(ocr)) flags.push('loop-ocr');
  const en = englishFraction(o);
  if (!/^(english|eng|en)$/i.test(language || '') && en != null && en >= 0.15) flags.push('wrong-lang');
  const ratio = bookMedian ? o.length / bookMedian : null;
  if (bookMedian >= 300 && o.length >= 10 && (ratio < 0.1 || ratio > 5)) flags.push('ratio');
  return { ol: o.length, ratio: ratio == null ? null : +ratio.toFixed(2), en: en == null ? null : +en.toFixed(3), flags };
}

export const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/** Roll page rows ({ book, flags }) up into the summary stored on the gate row. */
export function summariseScreens(rows, { examplesPerFlag = 10 } = {}) {
  const by_flag = {};
  const examples = {};
  const flaggedBooks = new Set();
  for (const r of rows) {
    for (const f of r.flags) {
      by_flag[f] = (by_flag[f] || 0) + 1;
      flaggedBooks.add(r.book);
      (examples[f] ??= []).length < examplesPerFlag && examples[f].push({ page_id: r.id, book_id: r.book, page_number: r.pg });
    }
  }
  return {
    pages: rows.length,
    books: new Set(rows.map((r) => r.book)).size,
    flagged_pages: rows.filter((r) => r.flags.length).length,
    flagged_books: flaggedBooks.size,
    by_flag,
    examples,
  };
}

/** A book's language bucket for stratification: the first named language, lower-cased. */
export const languageBucket = (lang) => String(lang || 'unknown').split(/[,;/+&]| and /i)[0].trim().toLowerCase() || 'unknown';

/**
 * Seats per language for an n-book draw: every language present gets one seat, largest first, until
 * the seats run out (the protocol: "at least one each where present"); the remaining seats go by
 * largest remainder of the language's share of the window. Pure; ties break by name.
 */
export function allocateSeats(countsByLang, n) {
  const langs = Object.entries(countsByLang).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const seats = Object.fromEntries(langs.map(([l]) => [l, 0]));
  let left = Math.min(n, langs.reduce((s, [, c]) => s + c, 0));
  for (const [l] of langs) { if (!left) break; seats[l] = 1; left--; }
  const total = langs.reduce((s, [, c]) => s + c, 0);
  while (left > 0) {
    const pick = langs
      .filter(([l, c]) => seats[l] < c)
      .map(([l, c]) => [l, (c / total) * n - seats[l]])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!pick) break;
    seats[pick[0]]++; left--;
  }
  return seats;
}

/**
 * The by-eye draw. `books` = [{ id, language }]; `pagesByBook` = Map(bookId → [{ id, page_number, ol }])
 * of the WINDOW's pages (ol = OCR body length). Picks `nBooks` books stratified by language with a
 * seeded mulberry32, and in each a run of `runLen` consecutive page numbers, preferring pages with
 * ≥ 150 chars of OCR (then ≥ 40, then any). Pure: the same inputs and seed give the same draw.
 */
export function drawSample(books, pagesByBook, { seed, nBooks = 10, runLen = 3 } = {}) {
  const rnd = makeRng(Number(seed));
  const withPages = books.filter((b) => (pagesByBook.get(b.id) || []).length).sort((a, b) => a.id.localeCompare(b.id));
  const byLang = {};
  for (const b of withPages) (byLang[languageBucket(b.language)] ??= []).push(b);
  const seats = allocateSeats(Object.fromEntries(Object.entries(byLang).map(([l, bs]) => [l, bs.length])), nBooks);
  const out = [];
  for (const lang of Object.keys(seats).sort()) {
    const pool = [...byLang[lang]];
    for (let k = 0; k < seats[lang] && pool.length; k++) {
      const book = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      const pages = [...pagesByBook.get(book.id)].sort((a, b) => a.page_number - b.page_number);
      let starts = [];
      for (const min of [150, 40, 0]) {
        const ok = new Map(pages.filter((p) => (p.ol || 0) >= min).map((p) => [p.page_number, p]));
        starts = [...ok.keys()].filter((n) => Array.from({ length: runLen }, (_, i) => ok.has(n + i)).every(Boolean));
        if (starts.length) break;
      }
      const byNum = new Map(pages.map((p) => [p.page_number, p]));
      const start = starts.length ? starts[Math.floor(rnd() * starts.length)] : pages[Math.floor(rnd() * pages.length)].page_number;
      const run = Array.from({ length: runLen }, (_, i) => byNum.get(start + i)).filter(Boolean);
      out.push({ book_id: book.id, language: book.language, bucket: lang, page_ids: run.map((p) => p.id), page_numbers: run.map((p) => p.page_number), consecutive: starts.length > 0 });
    }
  }
  return out;
}
