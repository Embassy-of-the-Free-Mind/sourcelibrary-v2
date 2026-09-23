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
