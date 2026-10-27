// PRIOR ART: src/lib/page-continuity.ts — judges ONE page's edges (opens/ends mid-sentence)
// for quote hints; it is TypeScript for the web app, cannot be imported by a worker, and never
// compares a translation against its source, which is the whole test here. Its lessons are
// kept: strip furniture before judging an edge, caseless scripts make no claim.
// scripts/eval/translation-batch-continuity-ab.mjs ocrProse/assessSeam — the OCR-housekeeping
// strip is ported (it runs a CLI on import); assessSeam judges BLOCK seams, not in-block
// boundaries. scripts/lib/scholarly-typst.mjs endsMidSentence/startsMidSentence — joins two
// halves of a split sentence at print time; does not look at the source.
/**
 * block-drift — did a block translation move page N+1's opening onto page N? (#5021)
 *
 * The realtime worker and the batch lane translate up to 8 pages in one prompt and cut the
 * answer back into pages by `<translation page="N">` tags. When page N's source ends in the
 * middle of a sentence, the model sometimes FINISHES that sentence on page N — rendering the
 * opening clause of page N+1 there — and starts page N+1's translation at the next sentence.
 * Every text is healthy; the clause is simply on the wrong page. A reader of N+1 never sees
 * it, a citation of N+1 for it fails, and the seam-repair pass never looks at in-block pages.
 *
 * The test, all of it readable from text we already hold:
 *   1. the SOURCE of N+1 opens mid-sentence: after its furniture (page number, running head,
 *      scanner junk) the first prose letter is lowercase — a cased script only; caseless
 *      scripts make no claim, as in page-continuity.ts;
 *   2. that opening fragment — up to its first full stop — is more than a hyphen-completed
 *      word (MIN_FRAGMENT_LETTERS), so there is a clause to lose;
 *   3. the TRANSLATION of N+1 opens as a fresh sentence (capital or digit, no leading
 *      ellipsis) — the fragment is not at its head;
 *   4. the TRANSLATION of N ends on sentence-final punctuation (no trailing ellipsis or
 *      hyphen) — the sentence the source left open was closed on page N.
 *
 *   5. page N's last translated sentence grew by about the fragment's length
 *      (absorbedShare ≥ MIN_ABSORBED_SHARE), or the fragment's numerals/proper names sit in
 *      N's tail rather than N+1's head.
 *
 * Steps 1–4 alone flag every boundary where a translator re-opened N+1 with a capital (a
 * rephrase, a running head) — 6 of 20 hand-read flags were real. Step 5 is the move itself.
 *
 * MEASURED (2026-09-24, local mirror, #5021): 2.03% of in-block prose boundaries flagged;
 * on a fresh hand-read sample of 20 (one per book) 9 were real moves, 8 false, 3 unclear.
 * The single-page lane (prompt v2/v5), which cannot move text, flags 0.7–0.9% — that is the
 * floor; block-era prompts (v10/v11) flag 2.0–2.4%. A false positive costs a single-page
 * re-translation of two pages, never a wrong text, which is why ~50% precision is enough for
 * the parser to act on.
 *
 * The second shape, duplicatedAcrossBoundary(): N+1's opening on BOTH pages — unless the SOURCE
 * repeats itself across the same boundary (sourceRepeatsAcrossBoundary, #5275): a sūtra's
 * refrain rendered on both leaves is the text, not a copy.
 *
 * The third shape, detectCaselessDrift() (#7503): the same move in unpunctuated Chinese (SKQS
 * columns), where steps 1, 2 and 5 cannot be read from letter case or full stops. The English
 * side is cased, so steps 3–4 stand; the source side is read from the column layout instead.
 *
 * Deliberately NOT caught: a German/Dutch fragment opening on a capitalised noun (reads as a
 * sentence start), a fragment with no full stop within FRAGMENT_WINDOW chars, caseless scripts
 * other than Han (Tibetan has its shad, but no calibration set yet).
 * Recall is traded for precision: a parser that rejects on this re-translates pages.
 */

import { blockLeafShiftRuns } from './leaf-shift.mjs';

export const MIN_FRAGMENT_LETTERS = 20;
export const FRAGMENT_WINDOW = 400;

const OCR_WRAPPERS = 'meta|vocab|language|lang|page-type|page-num|sig|scan-quality|script|columns|header|image-desc|folio|detected-images|catchword|warning|insert|margin|footnote|note';
export const TR_WRAPPERS = 'meta|summary|keywords|vocab|warning|note|header|page-num|sig|margin|catchword|image-desc|footnote|folio';

/** Source text with housekeeping removed (ported from continuity-ab ocrProse, notes too). */
export function sourceProse(ocr) {
  return String(ocr || '')
    .replace(new RegExp(`<(${OCR_WRAPPERS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/->|<-/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/** Translation body with editorial blocks removed. */
export function translationProse(tr) {
  return String(tr || '')
    .replace(new RegExp(`<(${TR_WRAPPERS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/[*_#>`~|]/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

// A line that is furniture, not prose: no word of three letters (page numbers, signature
// marks, scanner debris like "E r ? . |"), or a short line with no lowercase letter at all
// (running heads, "19", "BOOK ONE").
const isFurnitureLine = (line) => {
  const t = line.trim();
  if (!t) return true;
  if (!/\p{L}{3,}/u.test(t)) return true;
  if (t.length <= 40 && !/\p{Ll}/u.test(t)) return true;
  return false;
};

function dropLeadingFurniture(text) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && i < 6 && isFurnitureLine(lines[i])) i++;
  return lines.slice(i).join('\n').trim();
}

function dropTrailingFurniture(text) {
  const lines = text.split('\n');
  let j = lines.length;
  while (j > 0 && lines.length - j < 6 && isFurnitureLine(lines[j - 1])) j--;
  return lines.slice(0, j).join('\n').trim();
}

const CASED = /[\p{Ll}\p{Lu}]/u;
const FIRST_LETTER = /\p{L}/u;
// Full stops that close a sentence; ';' and ':' do not (they keep a clause going, and the
// Greek question mark is ';', so no claim there either).
const SENTENCE_END = /[.!?…](?:\s*[»”"'’)\]]+)?(?=\s|$)/u;
const TR_TERMINAL = /[.!?»”"'’)\]]$/u;
const TR_ELLIPSIS_TAIL = /(?:…|\.\s*\.\s*\.)\s*[»”"'’)\]]*$/u;
const TR_ELLIPSIS_HEAD = /^\s*[«“"'‘(\[]*\s*(?:…|\.\s*\.\s*\.)/u;

/**
 * An opening that is OCR noise, not prose: among the first six words, two or more that are a
 * lone letter ("f P Eine …") or shouting/garbled capitals ("va INDI GEO dARI"). A lowercase
 * first letter in debris says nothing about a sentence carried over.
 */
function looksLikeScanDebris(window) {
  const words = window.split(/\s+/).map(w => w.replace(/[^\p{L}]/gu, '')).filter(Boolean).slice(0, 6);
  const odd = words.filter(w => w.length === 1 || (w.length >= 2 && /\p{Lu}/u.test(w.slice(1)))).length;
  return odd >= 2;
}

/**
 * The clause a source page opens with when it continues the previous page, or null when
 * the page opens on a sentence (or the script is caseless, or there is no full stop soon).
 */
export function continuationFragment(ocrNext) {
  const head = dropLeadingFurniture(sourceProse(ocrNext));
  const window = head.slice(0, FRAGMENT_WINDOW);
  const firstLetter = window.match(FIRST_LETTER)?.[0];
  if (!firstLetter || !CASED.test(firstLetter)) return null;
  // Opening punctuation ("'mich", "‘riae") is fine; the first LETTER decides.
  const lead = window.slice(0, window.indexOf(firstLetter));
  if (/[\p{N}]/u.test(lead)) return null;
  if (firstLetter === firstLetter.toUpperCase()) return null;
  if (looksLikeScanDebris(window)) return null;
  const end = window.match(SENTENCE_END);
  if (!end) return null;
  const fragment = window.slice(0, end.index + end[0].length).replace(/\s+/g, ' ').trim();
  const letters = fragment.replace(/[^\p{L}]/gu, '').length;
  if (letters < MIN_FRAGMENT_LETTERS) return null;
  return fragment;
}

/** Numerals and capitalised words (not sentence-initial) — tokens that survive translation. */
export function anchorsOf(fragment) {
  const out = new Set();
  for (const m of fragment.matchAll(/\p{N}{2,}/gu)) out.add(m[0]);
  const words = fragment.split(/\s+/);
  words.forEach((w, i) => {
    const word = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    if (i > 0 && word.length >= 4 && /^\p{Lu}\p{Ll}/u.test(word)) out.add(word);
  });
  return [...out];
}

// Bracketed editorial blocks a translator puts at a page edge ("[The manuscript begins in the
// middle of a sentence …]", a trailing "[vocabulary: …]" list): not text of the page.
const stripEdgeBrackets = (t) => t.replace(/^\s*\[[^\]]{0,400}\]\s*/u, '').replace(/\s*\[[^\]]{0,3000}\]\s*$/u, '').trim();

const SENTENCE_ENDS = new RegExp(SENTENCE_END.source, 'gu');
const flat = (t) => t.replace(/\s+/g, ' ').trim();

/**
 * How much of the fragment's length page N's last translated sentence has absorbed.
 * P = the source's unfinished sentence at the foot of page N, T = the last sentence of page
 * N's translation, r = page N's translation/source length ratio. If the translation stopped
 * where the source stops, T ≈ r·P and the score is ≈ 0; if it carried on through the
 * fragment F, T ≈ r·(P + F) and the score is ≈ 1. Language-independent: lengths only.
 */
export function absorbedShare({ ocrPrev, trPrevTail, fragment }) {
  const src = flat(sourceProse(ocrPrev)), tr = flat(trPrevTail);
  if (!src || !tr) return 0;
  const srcEnds = [...src.matchAll(SENTENCE_ENDS)];
  const lastSrc = srcEnds[srcEnds.length - 1];
  const P = src.length - (lastSrc ? lastSrc.index + lastSrc[0].length : 0);
  const trEnds = [...tr.matchAll(SENTENCE_ENDS)];
  const prevEnd = trEnds.length >= 2 ? trEnds[trEnds.length - 2] : null;
  const T = tr.length - (prevEnd ? prevEnd.index + prevEnd[0].length : 0);
  const r = tr.length / src.length;
  return (T / r - P) / fragment.length;
}
export const MIN_ABSORBED_SHARE = 0.75;

const words = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/** Three consecutive words of the fragment's opening, verbatim in `text` (same-language books). */
function sharesOpening(fragment, text) {
  const f = words(fragment).slice(0, 10), t = ` ${words(text).join(' ')} `;
  for (let i = 0; i + 3 <= f.length; i++) if (t.includes(` ${f.slice(i, i + 3).join(' ')} `)) return true;
  return false;
}

/**
 * Judge one in-block boundary: page N (`ocrPrev`, `trPrev`) and page N+1 (`ocrNext`,
 * `trNext`). Returns { drift, fragment, absorbed, anchorVerdict } — drift=false carries a
 * `reason`.
 */
export function detectBlockDrift({ ocrPrev, ocrNext, trPrev, trNext, minAbsorbed = MIN_ABSORBED_SHARE, caseless = false }) {
  // The caseless (Han) test is opt-in: a hit is two pages re-read alone, which on a paid lane is spend
  // (claude-translate.mjs, on the subscription, opts in). Without it a Han page takes the cased path as before.
  if (caseless && isHanSource(ocrNext)) return detectCaselessDrift({ ocrPrev, ocrNext, trPrev, trNext });
  const fragment = continuationFragment(ocrNext);
  if (!fragment) return { drift: false, reason: 'source N+1 opens on a sentence (or no claim)' };
  const trNextHead = stripEdgeBrackets(dropLeadingFurniture(translationProse(trNext)));
  const trPrevTail = stripEdgeBrackets(dropTrailingFurniture(translationProse(trPrev)));
  if (!trNextHead || !trPrevTail) return { drift: false, reason: 'a translation is empty' };
  if (TR_ELLIPSIS_HEAD.test(trNextHead)) return { drift: false, reason: 'translation N+1 marks the continuation' };
  const first = trNextHead.match(/[\p{L}\p{N}]/u)?.[0];
  if (!first || (CASED.test(first) && first === first.toLowerCase())) {
    return { drift: false, reason: 'translation N+1 opens mid-sentence' };
  }
  if (TR_ELLIPSIS_TAIL.test(trPrevTail) || !TR_TERMINAL.test(trPrevTail)) {
    return { drift: false, reason: 'translation N leaves its last sentence open' };
  }
  // A translation that rephrases the opening with a capital ("The King showed … when he
  // forbade") keeps the clause where it belongs; in a same-language book the words show it.
  if (sharesOpening(fragment, trNextHead.slice(0, 400))) return { drift: false, reason: 'fragment opening found at the head of N+1', fragment };
  const anchors = anchorsOf(fragment);
  const tail = trPrevTail.slice(-600), head = trNextHead.slice(0, 400);
  const inTail = anchors.filter(a => tail.includes(a)), inHead = anchors.filter(a => head.includes(a));
  const anchorVerdict = !anchors.length ? 'no-anchors'
    : inTail.length > inHead.length ? 'moved'
      : inHead.length > inTail.length ? 'at-head'
        : 'unknown';
  if (anchorVerdict === 'at-head') return { drift: false, reason: 'fragment anchors found at the head of N+1', fragment, anchors };
  // The decisive test: did page N's last sentence grow by the fragment's length?
  const absorbed = ocrPrev == null ? null : absorbedShare({ ocrPrev, trPrevTail, fragment });
  if (absorbed != null && absorbed < minAbsorbed && anchorVerdict !== 'moved') {
    return { drift: false, reason: 'page N\'s last sentence did not grow by the fragment', fragment, absorbed };
  }
  return { drift: true, fragment, anchors, anchorVerdict, absorbed };
}

const HAN_CHARS = /\p{Script=Han}/gu;
const hanCount = (t) => (String(t || '').match(HAN_CHARS) || []).length;

/** A source page whose prose is Han, not a cased script: at least half its letters. */
export function isHanSource(ocr) {
  const prose = sourceProse(ocr);
  const letters = (prose.match(/\p{L}/gu) || []).length;
  return letters > 0 && hanCount(prose) / letters >= 0.5;
}

// Classical sentence-final particles: a page whose last column ends on one closed its sentence.
export const HAN_FINAL_PARTICLE = /[也矣焉哉乎歟耶耳]$/u;

/**
 * Does page N's source run over into N+1? SKQS text is unpunctuated, but it is set in columns
 * of a fixed length and a paragraph ends with a short column. So: the last prose column is
 * full (within one character of the page's 75th-percentile column, columns under 3 characters
 * — a title set one character to a line — left out) and does not end on a final particle.
 */
export function hanRunsOver(ocrPrev) {
  const cols = sourceProse(ocrPrev).split('\n').map((l) => (l.match(HAN_CHARS) || []).join('')).filter((l) => l.length >= 3);
  if (cols.length < 2) return false;
  const lens = cols.map((l) => l.length).sort((a, b) => a - b);
  const full = lens[Math.floor(lens.length * 0.75)];
  const last = cols[cols.length - 1];
  return full >= 8 && last.length >= full - 1 && !HAN_FINAL_PARTICLE.test(last);
}

// N+1 opens a new entry, not the rest of N's sentence: a commentary label (正義, 案/按, 注, 疏, 存疑) or a
// speaker ("鄭氏鍔曰", "朱子曰": 曰 within the first five characters), or the sentence ends on its first
// or second character (a final particle there: the word is finished on N, which is no clause to move).
const HAN_ENTRY_OPENING = /^(?:謹案|臣等謹案|正義|存疑|案|按|注|疏|[^曰]{1,4}曰|.?[也矣焉哉乎歟耶耳])/u;
export function hanOpensEntry(ocrNext) {
  const first = sourceProse(ocrNext).split('\n').map((l) => (l.match(HAN_CHARS) || []).join('')).find((l) => l.length >= 1) || '';
  return HAN_ENTRY_OPENING.test(first);
}

/**
 * English per source character on page N minus that on N+1, over their mean. Moving the
 * rendering of N+1's opening onto N makes it positive; with no move it is noise around 0.
 */
export function caselessShift({ ocrPrev, ocrNext, trPrev, trNext }) {
  const sp = hanCount(sourceProse(ocrPrev)), sn = hanCount(sourceProse(ocrNext));
  if (!sp || !sn) return null;
  const rp = flat(translationProse(trPrev)).length / sp, rn = flat(translationProse(trNext)).length / sn;
  return rp + rn ? (rp - rn) / ((rp + rn) / 2) : null;
}
export const MIN_CASELESS_SHIFT = 0;

/**
 * The #5021 move in a Han source (#7503). Unpunctuated SKQS OCR gives no lowercase letter and
 * no full stop, so the cased test never fires; a block read there finishes the sentence that
 * runs over the page break on page N and opens N+1 at the next sentence. Flagged when:
 *   1. the SOURCE of N runs over (hanRunsOver) — the sentence is open at the foot of N;
 *   2. the TRANSLATION of N closes on sentence-final punctuation (no trailing ellipsis), or on
 *      ';' — a list item closed on N (經濟類編 "use a white flag for stone;");
 *   3. after a full stop, the TRANSLATION of N+1 opens as a fresh sentence (capital or digit);
 *      after ';' the next item may open lowercase;
 *   4. page N carries more English per source character than N+1 (caselessShift >
 *      MIN_CASELESS_SHIFT): the clause has to have gone somewhere.
 *
 * A source N+1 that opens a new entry (hanOpensEntry: 正義/案/注…, a speaker's 曰, a final
 * particle on its first or second character) makes no claim.
 *
 * CALIBRATED (2026-10-27, #7503, the 60 Siku pages of #7518; scripts/eval/caseless-drift-7503/):
 * catches all 5 by-eye moves (3 at 4/call, 2 at 2/call); on the 90 page breaks of the two
 * 1/call runs, read as if they were blocks, 3 flags (3.3%); 2 of the 60 clean in-block breaks.
 * That is in-sample: the rule was fitted on these reads. HELD OUT (floor.mjs, ~400 sampled
 * Chinese books): one-page-per-call lanes, where every flag is false or a word finished across
 * the break, flag 3.6% (Opus), 4.1% and 6.3% (3.8 Flash-low, two lanes); the block Batch lanes
 * flag 8–9%. A hit costs two pages read again alone, never a wrong text.
 */
export function detectCaselessDrift({ ocrPrev, ocrNext, trPrev, trNext, minShift = MIN_CASELESS_SHIFT }) {
  if (ocrPrev == null || !hanRunsOver(ocrPrev)) return { drift: false, reason: 'source N does not run over (or no claim)' };
  if (hanOpensEntry(ocrNext)) return { drift: false, reason: 'source N+1 opens a new entry' };
  const trNextHead = stripEdgeBrackets(dropLeadingFurniture(translationProse(trNext)));
  const trPrevTail = stripEdgeBrackets(dropTrailingFurniture(translationProse(trPrev)));
  if (!trNextHead || !trPrevTail) return { drift: false, reason: 'a translation is empty' };
  if (TR_ELLIPSIS_HEAD.test(trNextHead)) return { drift: false, reason: 'translation N+1 marks the continuation' };
  if (TR_ELLIPSIS_TAIL.test(trPrevTail)) return { drift: false, reason: 'translation N leaves its last sentence open' };
  const listItem = /;$/u.test(trPrevTail);
  if (!listItem) {
    if (!TR_TERMINAL.test(trPrevTail)) return { drift: false, reason: 'translation N leaves its last sentence open' };
    const first = trNextHead.match(/[\p{L}\p{N}]/u)?.[0];
    if (!first || (CASED.test(first) && first === first.toLowerCase())) return { drift: false, reason: 'translation N+1 opens mid-sentence' };
  }
  const shift = caselessShift({ ocrPrev, ocrNext, trPrev, trNext });
  if (shift == null || shift <= minShift) return { drift: false, reason: 'page N carries no more English per character than N+1', shift };
  const fragment = sourceProse(ocrNext).split('\n').map((l) => (l.match(HAN_CHARS) || []).join('')).find((l) => l.length >= 3) || '';
  return { drift: true, fragment, shift, caseless: true };
}

/** Longest run two strings share (40-char shingles of b, extended both ways). */
export function sharedRun(a, b) {
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
  return { len: best, text: bestA >= 0 ? a.slice(bestA, bestA + Math.min(best, 200)) : '' };
}

export const DUPLICATE_MIN_CHARS = 150;
/**
 * The other shape of the same failure (#5021/#5026): page N+1's opening translated at the end
 * of page N AND again at the head of N+1. Measured on the corpus as a shared run between the
 * last 40% of N and the first 10% of N+1 — 7 of 7 such flags hand-read were real, and the
 * shape is absent from the single-page lane (prompt v2/v5), so it is a block artefact.
 */
export function duplicatedAcrossBoundary(trPrev, trNext) {
  const a = flat(translationProse(trPrev)), b = flat(translationProse(trNext));
  const tail = a.slice(Math.floor(a.length * 0.6)), head = b.slice(0, Math.max(600, Math.floor(b.length * 0.1)));
  const run = sharedRun(tail, head);
  return run.len >= DUPLICATE_MIN_CHARS ? run : null;
}

export const SOURCE_REPEAT_MIN_TOKENS = 6;
// A token is a run of letters, combining marks (the vowel signs and subjoined letters of
// Tibetan and Devanagari are marks, not letters) or digits. Everything else splits —
// whitespace, punctuation, the table pipes of a catalogue page, and for Tibetan the tsheg
// (U+0F0B) between syllables and the shad (U+0F0D) between clauses — so a Tibetan token is a
// syllable, and a repeated table scaffold ("| | subject | …") does not count as the source
// repeating.
const TOKEN_SPLIT = /[^\p{L}\p{M}\p{N}]+/u;
/** The source as lowercase tokens (words; syllables in Tibetan), furniture tags stripped. */
export function sourceTokens(ocr) {
  return flat(sourceProse(ocr)).toLowerCase().split(TOKEN_SPLIT).filter(Boolean);
}

/** Longest run of consecutive tokens `a` and `b` share, seeded on `minN`-grams of `b`. */
function longestTokenRun(a, b, minN) {
  const idx = new Map();
  for (let i = 0; i + minN <= b.length; i++) {
    const k = b.slice(i, i + minN).join(' ');
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(i);
  }
  let best = 0, bestText = '';
  for (let i = 0; i + minN <= a.length; i++) {
    const js = idx.get(a.slice(i, i + minN).join(' '));
    if (!js) continue;
    for (const j of js) {
      let L = minN;
      while (i + L < a.length && j + L < b.length && a[i + L] === b[j + L]) L++;
      if (L > best) { best = L; bestText = a.slice(i, i + L).join(' '); }
    }
  }
  return { len: best, text: bestText };
}

/**
 * Does the SOURCE repeat itself across the boundary? The same windows as
 * duplicatedAcrossBoundary — the last 40% of page N's source against the first 10% (at least
 * 60 tokens) of N+1's — share a run of SOURCE_REPEAT_MIN_TOKENS tokens. When they do, a run
 * the two TRANSLATIONS share is the text's own refrain rendered twice, not N+1's opening
 * copied onto N: a duplication is only a duplication when the source does not repeat.
 *
 * Tokens, not characters (#5275): the Kanjur's refrain ("…are non-dual; they cannot be divided,
 * are not separate, and are not distinct. Through the purity of…") recurs on both leaves of
 * 57 of 168 seam pages of the canonical pilot book, and the per-leaf guard refused every one
 * as `duplicated`. The Yigdzin OCR spells each recurrence a little differently (མྱི་དད vs མྱི་དང),
 * so the 40-char shingles of sharedRun() found the source repeating on only 20 of the 57;
 * syllable runs found it on all 57 (shortest 7). The audit script
 * (scripts/audit/translation-page-boundaries.mjs) makes the same distinction for its LEAK
 * count with character runs, which is fine for the cased-script prose it was sized on.
 *
 * Sized 2026-09-30 on the two pilot books (EXPERIMENTS.md): the 57 refused refrain pages
 * share 7–38 syllables across the seam; the 148 seam pages of the narrative rnam thar share
 * 0–5 on 138 and 6–12 on 10 (a stock formula on both leaves), so a real duplication on a
 * narrative page that also happens to repeat a formula across the seam is the trade — the
 * narrative book had 0 duplicate flags in 146 served translations to lose. The #5021 page-level
 * fixtures (German and Italian prose) all measure 0. Returns { len, text } or null; null too
 * when either source is missing, so the duplicate verdict stands as before.
 */
export function sourceRepeatsAcrossBoundary(ocrPrev, ocrNext) {
  const a = sourceTokens(ocrPrev), b = sourceTokens(ocrNext);
  if (!a.length || !b.length) return null;
  const tail = a.slice(Math.floor(a.length * 0.6)), head = b.slice(0, Math.max(60, Math.floor(b.length * 0.1)));
  const run = longestTokenRun(tail, head, SOURCE_REPEAT_MIN_TOKENS);
  return run.len >= SOURCE_REPEAT_MIN_TOKENS ? run : null;
}

/**
 * Every drifted boundary inside one parsed block. `pages` in block order (page_number,
 * ocr.data); `translations` is the parser's Map<page_number, text>. Returns an array of
 * { prev, next, kind: 'moved'|'duplicated', fragment } — empty when the block is clean.
 *
 * A shared translation run whose SOURCE also repeats across the boundary
 * (sourceRepeatsAcrossBoundary) is not a duplication — the boundary goes on to the `moved`
 * test like any other. The leaves of a `<leaf-break/>` page take this path too
 * (leaf-break.mjs leafUnitsHealth).
 */
export function blockDriftBoundaries(pages, translations, { caseless = false } = {}) {
  const found = [];
  for (let i = 0; i + 1 < pages.length; i++) {
    const a = pages[i], b = pages[i + 1];
    const trPrev = translations.get(a.page_number), trNext = translations.get(b.page_number);
    if (!trPrev || !trNext) continue;
    const dup = duplicatedAcrossBoundary(trPrev, trNext);
    if (dup && !sourceRepeatsAcrossBoundary(a.ocr?.data, b.ocr?.data)) {
      found.push({ prev: a.page_number, next: b.page_number, kind: 'duplicated', fragment: dup.text });
      continue;
    }
    const r = detectBlockDrift({ ocrPrev: a.ocr?.data, ocrNext: b.ocr?.data, trPrev, trNext, caseless });
    if (r.drift) found.push({ prev: a.page_number, next: b.page_number, kind: 'moved', fragment: r.fragment, anchorVerdict: r.anchorVerdict });
  }
  return found;
}

/**
 * Remove BOTH pages of every drifted boundary from a parsed block, so the caller's
 * existing "missing from batch" path re-translates them single-page, in order, each with the
 * previous page's translation as continuity. Mutates and returns `translations`.
 *
 * A whole-leaf shift (#5021, blockLeafShiftRuns: two or more adjacent pages whose English
 * prints only the neighbouring leaf's numbers) drops EVERY page of the block, kind 'leaf-shift':
 * a block that slipped one leaf usually slipped from some page onward, and the pages without
 * printed numbers cannot show it. Controls (scripts/audit/leaf-shift-gate-controls-5021.mjs,
 * 2026-10-15): the 12 by-eye wrong-leaf pages are caught in 6-8 of their 8 block alignments
 * (the misses are runs cut by a block edge); 7 of 3,321 single-page-lane blocks (0.21%) are
 * rejected, which costs those 8 pages a single-page translation, never a wrong text.
 */
export function dropDriftedPages(pages, translations, { caseless = false } = {}) {
  const drifted = blockDriftBoundaries(pages, translations, { caseless });
  // Read before any page is dropped: a dropped page breaks a run in two.
  const shifted = blockLeafShiftRuns(pages, translations);
  for (const d of drifted) { translations.delete(d.prev); translations.delete(d.next); }
  for (const run of shifted) {
    drifted.push({ prev: run.start, next: run.end, kind: 'leaf-shift', fragment: `${run.dir} leaf's numbers ${run.pages.map((x) => x.n.join('/')).join(', ')}` });
    for (const p of pages) translations.delete(p.page_number);
  }
  return { translations, drifted };
}
