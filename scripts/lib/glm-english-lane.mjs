// PRIOR ART: scripts/lib/syriac-kraken-lane.mjs (#4883) and the Paddle Chinese lane of PR #5607
// (scripts/lib/paddle-zh-lane.mjs, not yet on main) — the same lane shape: hold before the first write,
// revisions first, human-edit guard, loop guard, provenance on the page, staleness stamp. Its
// script-agnostic helpers (isHumanEdited, STALE_OCR_FIELDS, markTranslationsStale) are imported, not
// copied. What differs is the ENGINE (GLM-OCR on a rented GPU), the COHORT (English print 1600–1699 with
// pages never read) and the two GUARDS #5660 asked for before any GLM text is stored.
//
// The GLM English lane (#5660): read the English 1600–1699 backlog — books whose next step is OCR, pages
// with no OCR — with GLM-OCR (zai-org/GLM-OCR, 0.9B, MIT) served by vLLM.
//
// WHY THIS LANE EXISTS
// On 59 referenced English 1600–1699 library pages GLM-OCR's median CER is 0.034 against flash-lite's
// 0.053 (Δ −0.021 [−0.026, −0.002], better on 41, worse on 14), with 70 long-s misreads against lite's
// 1,030 (#5660 round 3, PR #5786). English needs no translation, so each finished book is readable.
//
// THE TWO GUARDS (#5660 verdict, 2026-10-04 04:35Z). A flagged page keeps NO GLM text: it stays unread,
// for the existing lane. The GLM read is kept in page_revisions (source GUARD_SOURCE) so a flag can be
// audited by eye against the image.
//   script      GLM writes "ישראל ישראל …" in place of every Hebrew title, confidently, and on Greek it is
//               catastrophic on 60 of 114 pages. In an English book a GLM read carrying letters of another
//               script is either a page in that script (GLM is not trusted there) or an invention. Also
//               refused: a word repeated ≥ REPEAT_RUN times in a row, and a #4850 repetition loop.
//   truncation  a read that hit the token cap, or one that ends mid-line (no closing punctuation) while
//               far shorter than the book's other pages — the olmOCR silent truncation of #5750 (a clean
//               `stop` after 10 % of the page) looks like this.
//
// NOTHING IS PAID, NOTHING IS TRANSLATED. No Gemini call is made anywhere in this lane. Every book is HELD
// (scripts/lib/pipeline-hold.mjs, reason HOLD_REASON) before its first page is written, because an OCR
// write otherwise lets the pipeline queue paid "translation" (pre-1820 English modernisation) through
// gap-fill (pipeline-status-truth.md, #4523). Derek, 2026-10-04: no translating English books.

import { contentHash } from './write-provenance.mjs';
import { loopVerdict } from './ocr-loop-guard.mjs';

export { isHumanEdited, STALE_OCR_FIELDS, markTranslationsStale } from './syriac-kraken-lane.mjs';

/** `ocr.pipeline` value, `sweep_log.sweep` name and `translation_stale.lane` — one id for the lane. */
export const LANE = 'glm-english-2026-10';
export const LANE_ISSUE = 5660;
/** `page_revisions.reason` for any reading this lane supersedes (the lane writes only unread pages). */
export const REVISION_REASON = 'ocr_glm_english_5660';
/** `page_revisions.source` of a GLM read a guard refused: the text is kept for audit, never served. */
export const GUARD_SOURCE = 'glm-english-guard-refused-2026-10';
/** `book_events.type` — one row per book, advanced in place. */
export const BOOK_EVENT = 'glm_english_ocr';
/** `pipeline_auto.hold.reason` for every book the lane touches. */
export const HOLD_REASON = 'glm-english-5660-ocr-only';
export const HOLD_RELEASE = 'the GLM-read English 1600–1699 cohort is OCR only (#5660; Derek 2026-10-04: no translating English books) — release with --to ocr_complete only when any further phase is approved as its own decision';
/** Below this many letters a read is textless (a plate, a blank leaf): never stored. */
export const MIN_LETTERS = 10;
/** Script guard: this many letters of a non-Latin script refuse the page. */
export const MAX_NON_LATIN = 2;
/** Script guard: the same word this many times in a row refuses the page. Not 3: "woe, woe, woe" is English (pilot, Winstanley 1650). */
export const REPEAT_RUN = 4;
/** Truncation guard: a page ending mid-line is flagged when shorter than this share of the book's median read. */
export const SHORT_SHARE = 0.5;
/** Truncation guard: the book median counts only when this many of its reads have ≥ MEDIAN_MIN_CHARS. */
export const MEDIAN_MIN_PAGES = 8;
export const MEDIAN_MIN_CHARS = 200;
/** Bumped whenever a guard rule changes, and stored on every page. */
export const GUARDS_VERSION = 'glm-english-guards/1';

/** The engine, in ONE place. The box run fills what it measured (vllm version, host, GPU). */
export const GLM = {
  name: 'GLM-OCR',
  model: 'zai-org/GLM-OCR',
  revision: '2e85a62840ccac27daa451df36c736c4636b8628',
  label: 'GLM-OCR 0.9B (Zhipu AI / Z.ai), vLLM OpenAI server, prompt "Text Recognition:", temperature 0',
  repo: 'https://github.com/zai-org/GLM-OCR',
  model_url: 'https://huggingface.co/zai-org/GLM-OCR',
  licence: 'MIT',
  prompt: 'Text Recognition:',
  conventions: 'the model\'s own Markdown, as returned; a leading/trailing ``` fence line dropped; NFC; trailing blank lines dropped; a Cyrillic look-alike inside a Latin-letter word mapped to its Latin twin (count in postprocess)',
  measured: '#5660 round 3 (PR #5786): English 1600–1699, 59 library pages, median CER 0.034 vs flash-lite 0.053, Δ −0.021 [−0.026, −0.002], 41 better / 14 worse',
};

const LATIN = /\p{Script=Latin}/u;
const LETTER = /\p{L}/u;
const FENCE = /^\s*```[a-zA-Z]*\s*$/;

/** The model's raw output → page body: fence lines dropped, NFC, trailing whitespace and blank tail removed. */
export function cleanGlm(raw) {
  return cleanGlmWithStats(raw).text;
}

/** cleanGlm and what it changed: `{ text, postprocess: { homoglyphs_fixed } }`. */
export function cleanGlmWithStats(raw) {
  const h = fixHomoglyphs(String(raw || '').normalize('NFC'));
  const lines = h.text.split(/\r?\n/).filter((l) => !FENCE.test(l)).map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return { text: lines.join('\n'), postprocess: { homoglyphs_fixed: h.fixed } };
}

/** Letters in a text, and how many are in a script other than Latin, by script. */
export function letterStats(text) {
  let letters = 0, nonLatin = 0;
  const scripts = {};
  for (const ch of String(text || '')) {
    if (!LETTER.test(ch)) continue;
    letters++;
    if (LATIN.test(ch)) continue;
    nonLatin++;
    const s = scriptOf(ch);
    scripts[s] = (scripts[s] || 0) + 1;
  }
  return { letters, nonLatin, scripts };
}

const SCRIPTS = ['Hebrew', 'Greek', 'Cyrillic', 'Arabic', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Syriac', 'Armenian', 'Georgian', 'Devanagari', 'Tamil', 'Thai', 'Ethiopic', 'Coptic'];
const SCRIPT_RE = Object.fromEntries(SCRIPTS.map((s) => [s, new RegExp(`\\p{Script=${s}}`, 'u')]));
function scriptOf(ch) {
  for (const s of SCRIPTS) if (SCRIPT_RE[s].test(ch)) return s;
  return 'other';
}

/**
 * Longest run of one word repeated back to back: `{ word, run }`. A word has ≥ 2 letters; a token with no
 * letter (a number, a rule) BREAKS a run — a price table's "Of 1 1/2 30 / Of 2 40 / Of 3 …" is not "of of of".
 */
export function longestWordRun(text) {
  const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean)
    .map((w) => w.replace(/[^\p{L}\p{M}]/gu, ''));
  let best = { word: null, run: 0 }, cur = 0;
  for (let i = 0; i < words.length; i++) {
    if (!words[i]) { cur = 0; continue; }
    cur = i > 0 && words[i] === words[i - 1] ? cur + 1 : 1;
    if ([...words[i]].length >= 2 && cur > best.run) best = { word: words[i], run: cur };
  }
  return best;
}

/** Cyrillic letters GLM sometimes emits inside an English word ("lossе" with Cyrillic е), and their Latin twins. */
const HOMOGLYPH = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ѕ': 's', 'ј': 'j', 'ԁ': 'd', 'ӏ': 'l',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I', 'Ѕ': 'S', 'Ј': 'J' };
const HOMO_RE = new RegExp(`[${Object.keys(HOMOGLYPH).join('')}]`, 'gu');

/**
 * A Cyrillic look-alike INSIDE a word that also carries Latin letters is the Latin letter (measured on the
 * pilot: "lossе", "seene"). A word with no Latin letter is left alone — that is Cyrillic text, and the
 * script guard refuses it. Returns `{ text, fixed }`; `fixed` is stored on the page (engine.postprocess).
 */
export function fixHomoglyphs(text) {
  let fixed = 0;
  const out = String(text || '').replace(/[\p{L}\p{M}]+/gu, (w) => {
    if (!LATIN.test(w) || !HOMO_RE.test(w)) { HOMO_RE.lastIndex = 0; return w; }
    HOMO_RE.lastIndex = 0;
    return w.replace(HOMO_RE, (c) => { fixed++; return HOMOGLYPH[c]; });
  });
  return { text: out, fixed };
}

/**
 * The script guard. `{ pass, reasons[], detail }`; a page with any reason keeps no GLM text.
 *   non_latin_script   ≥ MAX_NON_LATIN + 1 letters outside the Latin script (English print is read in Latin)
 *   repeated_word      one word ≥ REPEAT_RUN times in a row ("ישראל ישראל ישראל")
 *   loop               the #4850 repetition-loop verdict
 */
export function scriptGuard(body) {
  const ls = letterStats(body);
  const wr = longestWordRun(body);
  const lv = loopVerdict(body);
  const reasons = [];
  if (ls.nonLatin > MAX_NON_LATIN) reasons.push('non_latin_script');
  if (wr.run >= REPEAT_RUN) reasons.push('repeated_word');
  if (lv.refuse) reasons.push('loop');
  return {
    pass: reasons.length === 0, reasons,
    detail: { letters: ls.letters, non_latin: ls.nonLatin, scripts: ls.scripts, word_run: wr.run, word: wr.run >= REPEAT_RUN ? wr.word : null, loop_share: lv.share ?? 0 },
  };
}

/** Does the last line of a read close (sentence punctuation, a hyphen carrying the word over, a bracket or quote)? */
export function endsClosed(body) {
  const lines = String(body || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return true;
  const last = lines[lines.length - 1].replace(/[*_`#>]+$/g, '').trim();
  if (!last) return true;
  // a catchword or signature mark alone on the bottom line (one or two short tokens) is how a printed page ends
  if (last.split(/\s+/).length <= 2 && last.length <= 14) return true;
  return /[.!?:;)\]}"'”’»\-‐‑–—=¬]$/u.test(last) || /<\/[a-z-]+>$/i.test(last);
}

/** Median character count of a book's GLM reads that carry ≥ MEDIAN_MIN_CHARS, or null below MEDIAN_MIN_PAGES of them. */
export function bookMedianChars(lengths) {
  const xs = lengths.filter((n) => n >= MEDIAN_MIN_CHARS).sort((a, b) => a - b);
  if (xs.length < MEDIAN_MIN_PAGES) return null;
  return xs[xs.length >> 1];
}

/**
 * The truncation guard. `meta` is what the box recorded for the call: `finish` (OpenAI finish_reason),
 * `out_tok`, `max_tokens`. `median` is bookMedianChars() over the same book's reads (null = unknown).
 *   token_cap      finish = length, or out_tok ≥ max_tokens
 *   ends_mid_line  the last line does not close AND the read is under SHORT_SHARE of the book median
 */
export function truncationGuard(body, meta = {}, median = null) {
  const reasons = [];
  const capped = meta.finish === 'length' || (meta.out_tok != null && meta.max_tokens != null && meta.out_tok >= meta.max_tokens);
  if (capped) reasons.push('token_cap');
  const chars = String(body || '').length;
  const closed = endsClosed(body);
  const short = median != null && chars < SHORT_SHARE * median;
  if (!closed && short) reasons.push('ends_mid_line');
  return {
    pass: reasons.length === 0, reasons,
    detail: { finish: meta.finish ?? null, out_tok: meta.out_tok ?? null, max_tokens: meta.max_tokens ?? null, chars, book_median_chars: median, ends_closed: closed },
  };
}

/** Both guards, one verdict — the object stored on the page as `ocr.guards`. */
export function guardVerdict(body, meta, median) {
  const script = scriptGuard(body);
  const truncation = truncationGuard(body, meta, median);
  return { version: GUARDS_VERSION, pass: script.pass && truncation.pass, script, truncation, issue: LANE_ISSUE };
}

/** The in-text envelope consumers trust, as the Kraken and Paddle lanes write it. No `<page-type>`: GLM does not classify pages. */
export function envelope(body) {
  return `<language>English</language>\n<script>printed</script>\n\n${String(body || '').trim()}`;
}

/**
 * The `$set` half of a page write. `text` is the ENVELOPED reading; `box` is what the box run reported
 * (vllm version, host, gpu); `meta` the call's own record (secs, finish, out_tok, max_tokens).
 */
export function ocrSetFields(text, { run, now = new Date(), imageUrl = null, box = {}, meta = {}, guards = null } = {}) {
  return {
    'ocr.data': text,
    'ocr.content_hash': contentHash(text),
    'ocr.language': 'English',
    'ocr.model': GLM.model,
    'ocr.source': 'glm-ocr',
    'ocr.pipeline': LANE,
    'ocr.updated_at': now,
    'ocr.engine': {
      name: GLM.name, model: GLM.model, revision: box.revision || GLM.revision,
      revision_source: box.revision ? 'logged: the HF snapshot the box served' : 'pinned: the snapshot the #5660 round-3 bake-off served',
      model_label: GLM.label, repo: GLM.repo, model_url: GLM.model_url, licence: GLM.licence,
      prompt: GLM.prompt, conventions: GLM.conventions,
      generation: { temperature: 0, max_tokens: meta.max_tokens ?? null, finish: meta.finish ?? null, out_tok: meta.out_tok ?? null },
      run: run || LANE, code_version: box.code_rev || null, issue: LANE_ISSUE, secs: meta.secs ?? null, host: box.host || null, gpu: box.gpu || null,
      serving: { backend: 'vllm', vllm: box.vllm_version || null, clients: box.clients ?? null },
      postprocess: meta.postprocess || null,
      input: imageUrl ? { image_url: imageUrl } : { status: 'not_recorded', reason: 'caller passed no image url' },
    },
    'ocr.guards': guards,
    updated_at: now,
  };
}
