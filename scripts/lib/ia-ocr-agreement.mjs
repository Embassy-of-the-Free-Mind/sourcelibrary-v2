// PRIOR ART: scripts/import/ia-ocr-ingest.mjs held `tokens()` + `ratio()` inline (#4727 → #4783) and
// scripts/eval/ia-ocr-delivered-quality.mjs carried a copy marked "keep in lockstep" — both now
// import from here. scripts/eval/lib/metrics.mjs `agreementPrimary` (#3235/#3473) already found the
// same failure (word tokens collapse space-less scripts: Chinese 36.7% word vs 72.7% char agreement)
// but is a Levenshtein metric with its own normalisation; the gate's per-language cutoffs (#4790)
// are calibrated on THIS ratio, so the ratio stays and only the tokenizer learns scripts, reusing
// metrics' SPACELESS_RE and normalizeCJK. scripts/lib/blank-page-guard.mjs `transcriptionBody`
// strips editorial blocks too, but also drops headers, signatures and catchwords, which ARE printed
// on the leaf and must count here.
//
// ia-ocr-agreement — the free IA OCR lane's agreement score between our model's reading of a leaf
// and the Internet Archive's reading of the same leaf (scripts/import/ia-ocr-ingest.mjs).
//
// THE SCORE. difflib-style sequence ratio 2·LCS/(|a|+|b|) over the first 600 tokens of each side.
// Per-language cutoffs (scripts/lib/ia-ocr-gate.mjs, #4790) are calibrated on exactly this number;
// change the tokenizer or the ratio and every cutoff has to be re-measured.
//
// THE TOKEN IS THE SCRIPT'S UNIT (#4806, 2026-09-13). A word tokenizer finds ONE token in a page of
// unspaced Chinese (the whole run), which turns the ratio into a binary whole-page exact match: a
// realistic one-character near-miss scored 0.000 by words and 0.977 by characters. Every Chinese
// book in the July baseline "collapsed" on that artifact and 1.59M pages were written off. So:
//   - a run of a space-less script (Han, kana, Thai, Lao, Khmer, Myanmar, Tibetan — metrics'
//     SPACELESS_RE) is one token PER CHARACTER, folded by normalizeCJK (edition glyph variants) and
//     NFKC (full-width forms);
//   - everything else stays a word token exactly as before (`[\p{L}\p{N}']+` plus `\p{M}` so a
//     Devanagari or Arabic word is not cut at every vowel mark, with Arabic/Hebrew pointing stripped;
//     lower-cased, NFC, curly apostrophes folded) — measured byte-identical on 270 English/Latin/Greek
//     books (PR #4810);
//   - a mixed page is segmented run by run, never classified whole.
//   Tibetan is tsheg-delimited and already split into syllables by the word regex; it is listed in
//   SPACELESS_RE for metrics' own reasons and character units are also fine for it.
//
// EDITORIAL BLOCKS ARE COUNTED — KNOWN BIAS, NOT FIXED HERE (#4806). The model's reading carries
// `<image-desc>`, `<vocab>`, `<meta>` … blocks whose CONTENT describes the page rather than
// transcribes it, and `tokens()` counts them against the Archive text (which has none). Measured on
// the 2026-09-13 regression sample: dropping them lifts an English book's median by +0.02–0.04
// (`keep_ed` = old score exactly, so the tokenizer is otherwise byte-identical), and on a Chinese
// index leaf 75 English words of image description against 30 characters cap a PERFECT match at
// 0.44. It is NOT dropped here because every per-language cutoff (#4790) was calibrated on the
// biased score — dropping it silently loosens the gate by ~0.03. `tokensBody()` is the corrected
// variant; scripts/eval/ia-ocr-cjk-control.mjs measures both, and switching the gate to it means
// re-deriving the cutoffs in the same PR.
import { normalizeCJK, SPACELESS_RE } from '../eval/lib/metrics.mjs';

/** Elements whose contents describe the page rather than transcribe it (see header). */
export const EDITORIAL_BLOCKS = ['image-desc', 'meta', 'summary', 'keywords', 'vocab', 'warning',
  'language', 'script', 'scan-quality', 'quality', 'page-type', 'columns'];
const EDITORIAL_RE = new RegExp(`<(${EDITORIAL_BLOCKS.join('|')})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');

const WORD_RE = /[\p{L}\p{M}\p{N}']+/gu;
const SPACELESS_RUN_RE = new RegExp(`${SPACELESS_RE.source}+`, 'gu');

/** `tokens()` of the transcribed text only: editorial blocks dropped with their content (see header). */
export const tokensBody = (s) => tokens((s || '').replace(EDITORIAL_RE, ' '));

// Arabic tashkeel + tatweel and Hebrew niqqud + cantillation are EDITION-level pointing, not text:
// one side vowelled and the other not read as two different words once `\p{M}` stays inside a word
// (measured 2026-09-13: a pointed Qurʾān fell 0.106 → 0.016). Stripped before tokenizing, as
// metrics' SCRIPT_DEFS.arabic/hebrew folds do. Devanagari vowel signs are NOT stripped — they are
// part of the word in every edition. Maqaf (U+05BE) is punctuation and already splits.
const POINTING_RE = /[ً-ْٰـ֑-ׇֽֿׁׂׅׄ]/g;

/** Text of one side → token list: characters for space-less runs, words elsewhere. */
export function tokens(s) {
  // A TAG opens with a letter or a slash. `<[^>]+>` also matched the model's centred-heading
  // marker `->TITLE<-`, whose `<-` then swallowed everything up to the next real tag's `>` —
  // deleting the whole page body from the comparison. Measured on divineinspiratio00will p9
  // (#4966): 25 tokens survived instead of 348, and the page scored 0.086 against IA text it
  // actually matches at 0.983, dragging the book's median to 0.624 and REJECTING it at the 0.80
  // gate. Any page carrying `->…<-` plus any later tag was affected.
  const text = (s || '').replace(/<\/?[A-Za-z][^>]*>/g, ' ').normalize('NFC').replace(POINTING_RE, '').replace(/[’‘ʼ]/g, "'").toLowerCase();
  const out = [];
  for (const w of text.match(WORD_RE) || []) {
    if (!SPACELESS_RE.test(w)) { out.push(w); continue; }
    // Mixed word: split at the boundaries of space-less runs; each run yields one token per character.
    let last = 0;
    for (const m of w.matchAll(SPACELESS_RUN_RE)) {
      if (m.index > last) out.push(w.slice(last, m.index));
      for (const ch of normalizeCJK(m[0].normalize('NFKC'))) out.push(ch);
      last = m.index + m[0].length;
    }
    if (last < w.length) out.push(w.slice(last));
  }
  return out;
}

/** difflib-style sequence ratio 2·LCS/(|a|+|b|) over the first 600 tokens of each side. */
export function ratio(a, b) {
  a = a.slice(0, 600); b = b.slice(0, 600);
  if (!a.length || !b.length) return 0;
  const prev = new Uint16Array(b.length + 1); const cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev.set(cur);
  }
  return (2 * prev[b.length]) / (a.length + b.length);
}

/** The ratio of two texts. */
export const agreement = (a, b) => ratio(tokens(a), tokens(b));

// ---------- numeric agreement: the digits gate (#5186) ----------
// The word ratio above cannot see a misread number: "1886" for 1836 is a perfectly good word, and
// the four #5186 county histories passed the 0.80 gate at 0.977–0.990 with 1–8% of their years
// wrong. The numbers test (#5224, scripts/eval/results/numbers-5224/report.md) found engine
// agreement on a number is right on the image 98.8% of the time, so the share of the model's
// numbers the Archive also printed is a free, per-book proxy for how far its digits can be trusted.
//
// THE TOKEN is #5224's v1: NFKC, split on anything not a letter or digit, keep /^\d{2,4}$/
// ("1,538" → 538; "188%" → 188). A digit read as a letter ("i860", "SSI") is no longer a number
// on the Archive side, so it counts as a miss — which is the point.
// THE FOLIO is excluded on both sides: the Archive drops margin page numbers often (44 of its 266
// #5224 errors), which is a furniture problem, not a digits problem. The model's `<page-num>` is
// the folio when present; otherwise a bare number opening or closing the first or last short line.
// Model editorial blocks (`<vocab>`, `<meta>` …) and `<page-num>` are dropped before counting.

const NUM_TOKEN_RE = /^\d{2,4}$/;
const numTokens = (s) => String(s || '').normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter((w) => NUM_TOKEN_RE.test(w));

/** A bare number opening/closing the first or last line of ≤ 10 words: the probable folio. */
function edgeFolio(text) {
  const ls = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of [ls[0], ls[ls.length - 1]]) {
    const ws = (l || '').split(/\s+/);
    if (!l || ws.length > 10) continue;
    for (const w of [ws[0], ws[ws.length - 1]]) { const m = w.match(/^(\d{1,4})[.,:;]?$/); if (m) return String(+m[1]); }
  }
  return null;
}

/**
 * The 2–4-digit numbers a page prints, as a Map number → count, folio removed (one occurrence).
 * `isModel`: the text is a model read (editorial blocks and `<page-num>` dropped, tags stripped).
 */
export function pageNumberCounts(text, isModel = false) {
  let t = String(text || ''); let folio = null;
  if (isModel) {
    const pn = t.match(/<page-num>\s*(\d{1,4})\s*<\/page-num>/i);
    if (pn) folio = String(+pn[1]);
    t = t.replace(EDITORIAL_RE, ' ').replace(/<page-num>[\s\S]*?<\/page-num>/gi, ' ').replace(/<\/?[A-Za-z][^>]*>/g, '\n');
  }
  if (folio === null) folio = edgeFolio(t);
  const counts = new Map();
  for (const n of numTokens(t)) counts.set(n, (counts.get(n) || 0) + 1);
  if (folio !== null && counts.get(folio)) { if (counts.get(folio) > 1) counts.set(folio, counts.get(folio) - 1); else counts.delete(folio); }
  return counts;
}

/**
 * Of the numbers on the model's reading of a leaf, how many the Archive's reading of the SAME leaf
 * also printed (multiset). Returns `{ ref, matched }` — pool these over a book's reference pages
 * and judge the pooled share with `iaOcrDigitsVerdict` (scripts/lib/ia-ocr-gate.mjs).
 */
export function numericAgreement(modelText, iaText) {
  const a = pageNumberCounts(modelText, true);
  const b = pageNumberCounts(iaText);
  let ref = 0, matched = 0;
  for (const [n, c] of a) { ref += c; matched += Math.min(c, b.get(n) || 0); }
  return { ref, matched };
}
