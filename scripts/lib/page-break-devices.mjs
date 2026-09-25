// PRIOR ART: scripts/lib/page-integrity.mjs — parseCatchword / foldWord / tokenMatches are IMPORTED
// from it; it DETECTS a broken chain of leaves for the audit and never edits a page's text.
// scripts/lib/block-drift.mjs — sourceProse strips the wrappers but discards the offsets an edit
// needs, so the masking here keeps the raw string's indices. scripts/lib/translate-batch-seam.mjs —
// repairs a TRANSLATION after the model wrote it; this edits the SOURCE before the model sees it.
/**
 * page-break-devices — the printer's devices at a page break, resolved BEFORE the translator sees
 * the page (#5103).
 *
 * An early printed page ends with two devices a translator has to know about and a model is told
 * nothing about:
 *
 *   catchword    the next page's first word, printed again at the foot of this page so the binder
 *                could order the leaves. OCR puts it in <meta>catchword: …</meta>, or at the end of
 *                the body, or both. The source-grounded seam judge (EXPERIMENTS.md 2026-09-25 late)
 *                found production translating it on BOTH pages ("to whom / to whom") or fusing it
 *                into the last sentence.
 *   split word   a word broken by a hyphen at the foot ("Augspur-") and finished at the head of the
 *                next page ("gischen"). Production rendered the verb of "Damna-|mnatur" nowhere and
 *                "auctorita-|toritate" twice.
 *
 * Both are exact, so they are resolved deterministically: the split word is joined onto the page
 * where it begins and its fragment removed from the next page's translatable text; a trailing
 * catchword is removed from this page's text and named as a device. Nothing is guessed about
 * meaning — the edits are string edits on the OCR, and every edit is reported so a caller can log it.
 *
 * Shapes handled, each pinned by a real seam in tests/unit/translate-page-break.test.ts:
 *   catchword       body ends with the next page's first word (whole, or its first syllable "Anony-")
 *   split           body ends "Augspur-", next page opens "gischen"  → Augspurgischen
 *   split, overlap  OCR merged the catchword into the fragment: "Damna-" | "mnatur" → Damnatur,
 *                   "auctorita-" | "toritate" → auctoritate (the longest suffix/prefix overlap wins)
 *   split+catchword "Episcopo-⏎rum" | "rum constantia" → Episcoporum, next page loses "rum"
 *   carried whole   "Gri-⏎chischen" | "Griechischen gefraget" → this page keeps Griechischen, next
 *                   page loses it
 *   merged          "cum nihil" | "hil impetrare" — the catchword "hil" was merged into "nihil" by
 *                   OCR; the next page loses "hil"
 *
 * Everything returns an explicit `kind: null` when nothing fires; a page with no letters at either
 * side is left untouched (non-latin-text-operations.md — silence is never counted as clean).
 */
import { parseCatchword, foldWord, tokenMatches } from './page-integrity.mjs';

/** Hyphens a printer or an OCR model puts at a broken word: hyphen, U+2010/2011, Fraktur ⸗ and =, ¬. */
export const BREAK_HYPHEN = /[-‐‑⸗=¬]/;

// Wrapper blocks whose content is apparatus, not the page's prose: masked before a token is looked
// for so the last word of the BODY is found, not the last word of the vocab list or a margin note.
const WRAPPERS = 'meta|vocab|language|lang|page-type|page-num|sig|scan-quality|script|columns|header|image-desc|folio|detected-images|catchword|warning|margin|footnote|note';
const WRAPPER_RE = new RegExp(`<(${WRAPPERS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');
const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const MARK_RE = /->|<-|[*_#>`~|]/g;

/** The raw OCR with apparatus blanked to spaces of the same length, so indices still address it. */
export function maskApparatus(raw) {
  const blank = (m) => ' '.repeat(m.length);
  return String(raw || '').replace(WRAPPER_RE, blank).replace(TAG_RE, blank).replace(MARK_RE, blank);
}

// A word: letters/marks/digits with an optional inner apostrophe, then an optional break hyphen.
const TOKEN_RE = /([\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’]*)([-‐‑⸗=¬]?)/gu;
const hasLetter = (w) => /\p{L}/u.test(w);

/** Every letter-bearing token of a masked page, with its span in the raw string. */
function tokens(masked) {
  const out = [];
  for (const m of masked.matchAll(TOKEN_RE)) {
    if (!hasLetter(m[1])) continue;
    out.push({ word: m[1], hyphen: !!m[2], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const lower = (w) => w.toLowerCase();
/** The completion of a split word is never capitalised in print, except an all-capitals word. */
const asContinuation = (w) => (/^\p{Lu}{2,}$/u.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1));

/** Splice `replace` over [start,end) of `raw`, tidying a doubled space. */
function splice(raw, start, end, replace) {
  const before = raw.slice(0, start), after = raw.slice(end);
  const out = before + replace + after;
  return replace === '' ? (before.replace(/[ \t]+$/, '') + after.replace(/^[ \t]+/, '')).replace(/\n{3,}/g, '\n\n') : out;
}

/**
 * The longest overlap (≥ 2 characters, shorter than either word) between the END of a fragment and the
 * START of the next page's first word — an OCR that merged the catchword into the fragment produces
 * "Damna-" | "mnatur", where the true word is Damnatur, not Damnamnatur.
 */
export function overlapLength(fragment, next) {
  const f = lower(fragment), n = lower(next);
  for (let k = Math.min(f.length - 1, n.length - 1); k >= 2; k--) if (f.endsWith(n.slice(0, k))) return k;
  return 0;
}

/**
 * Resolve the devices at the break between page N (`ocrN`) and page N+1 (`ocrNext`).
 *
 * @param {string} ocrN      OCR of the page that ends at the break
 * @param {string} ocrNext   OCR of the page that begins after it
 * @param {object} [opts]
 * @param {boolean} [opts.splitWords=true]  join a word broken by the break onto page N
 * @param {boolean} [opts.catchwords=true]  remove a trailing catchword from page N's text
 * @returns {{
 *   kind: null|'catchword'|'split'|'split+catchword'|'merged-catchword',
 *   catchword: string|null,   the device found (printed form), whether removed from the body or only tagged
 *   joined: string|null,      the word assembled across the break, now wholly on page N
 *   removedFromN: string|null, removedFromNext: string|null,
 *   ocrN: string, ocrNext: string,   the edited texts (unchanged when nothing fired)
 * }}
 */
export function resolvePageBreak(ocrN, ocrNext, { splitWords = true, catchwords = true } = {}) {
  let rawN = String(ocrN || ''), rawX = String(ocrNext || '');
  const res = { kind: null, catchword: null, joined: null, removedFromN: null, removedFromNext: null, ocrN: rawN, ocrNext: rawX };
  if (!rawN.trim() || !rawX.trim()) return res;

  const first = tokens(maskApparatus(rawX))[0];
  if (!first) return res;
  const ff = foldWord(first.word);
  if (!ff) return res;
  const meta = parseCatchword(rawN);
  const metaWord = meta?.judged ? meta.tokens[0] : null;
  // A tagged catchword that the next page opens with is a device worth naming even when the body
  // does not repeat it (the model translates the tag's word too, see j111 "Augsburg Confession").
  if (metaWord && tokenMatches(metaWord, ff)) res.catchword = meta.printed;

  let toks = tokens(maskApparatus(rawN));
  let last = toks[toks.length - 1];
  if (!last) return res;
  let fl = foldWord(last.word);
  let nextConsumed = false;

  // ── 1. a trailing catchword in the body: the next page's first word, whole or as its first syllable
  if (catchwords && fl) {
    // Whole: the same word, allowing one misread letter in four or more ("Dare" | "Darum" is
    // caught by the tag agreeing below). The OCR model often copies the page's own last word into
    // the catchword tag, so the tag alone never decides — the next page must open with the word.
    const whole = fl.length >= 2 && (fl === ff
      || (fl.length >= 4 && fl.length === ff.length && tokenMatches(fl, ff))
      || (metaWord === fl && tokenMatches(fl, ff)));
    // Syllable: the body ends with the first syllable of the next page's word ("Anony-", "ente").
    // Without a hyphen or the tag's agreement a two-letter match ("in" | "interea") is too weak.
    const syllable = !whole && ff.length > fl.length && ff.startsWith(fl) && fl.length >= 2
      && (last.hyphen || fl.length >= 3 || metaWord === fl);
    if (whole || syllable) {
      res.catchword = res.catchword || last.word;
      res.removedFromN = last.word + (last.hyphen ? '-' : '');
      res.kind = 'catchword';
      rawN = splice(rawN, last.start, last.end, '');
      toks = tokens(maskApparatus(rawN));
      last = toks[toks.length - 1];
      fl = last ? foldWord(last.word) : '';
    }
  }

  if (last && splitWords) {
    // ── 2. a word broken at the break: "Augspur-" | "gischen"
    if (last.hyphen) {
      const k = overlapLength(last.word, first.word);
      const joined = last.word + (k ? first.word.slice(k) : asContinuation(first.word));
      res.joined = joined;
      res.removedFromNext = first.word;
      res.kind = res.kind === 'catchword' ? 'split+catchword' : 'split';
      rawN = splice(rawN, last.start, last.end, joined);
      rawX = splice(rawX, first.start, first.end, '');
      nextConsumed = true;
    } else if (toks.length >= 2 && toks[toks.length - 2].hyphen && res.kind == null) {
      // ── 3. the catchword completed the split word on this page and the next page repeats the whole
      //       word: "Gri-⏎chischen" | "Griechischen"
      const prev = toks[toks.length - 2];
      const pf = foldWord(prev.word);
      if (ff.endsWith(fl) && fl.length >= 3 && ff.length >= fl.length + 2 && pf.length >= 2 && ff.startsWith(pf.slice(0, 2))) {
        res.joined = first.word;
        res.removedFromNext = first.word;
        res.catchword = res.catchword || last.word;
        res.kind = 'split+catchword';
        rawN = splice(rawN, prev.start, last.end, first.word);
        rawX = splice(rawX, first.start, first.end, '');
        nextConsumed = true;
      }
    }
  }

  // ── 4. OCR merged the catchword into the last word: "cum nihil" | "hil impetrare"
  if (!nextConsumed && catchwords && last && res.kind == null && fl.length >= ff.length + 2 && ff.length >= 3
      && fl.endsWith(ff) && /^\p{Ll}/u.test(first.word)) {
    res.kind = 'merged-catchword';
    res.catchword = res.catchword || first.word;
    res.removedFromNext = first.word;
    rawX = splice(rawX, first.start, first.end, '');
  }

  res.ocrN = rawN;
  res.ocrNext = rawX;
  return res;
}

/** Longest lookahead sent as context, and the least before a sentence end is honoured. */
export const LOOKAHEAD_MAX_CHARS = 400;
export const LOOKAHEAD_MIN_CHARS = 60;
/**
 * The clause-length lookahead: only as far as the first clause boundary (comma, colon, semicolon or
 * sentence end) past a short minimum — enough to see how the crossing clause ends, too little to be
 * worth translating. The sentence-length one was translated on page N by flash-lite in the first
 * measurement (EXPERIMENTS.md 2026-09-25 night: duplication 5 → 12).
 */
export const LOOKAHEAD_CLAUSE = Object.freeze({ max: 160, min: 12, clause: true });

/**
 * The opening of the next page as prose: apparatus off, the first sentence (at least
 * LOOKAHEAD_MIN_CHARS, since incunabula punctuate abbreviations with a point), at most
 * LOOKAHEAD_MAX_CHARS, cut at a word. Empty when the page has no prose. With `clause`, the first
 * clause boundary counts as an end too.
 */
export function lookaheadSnippet(ocrNext, { max = LOOKAHEAD_MAX_CHARS, min = LOOKAHEAD_MIN_CHARS, clause = false } = {}) {
  const prose = maskApparatus(ocrNext).replace(/\s+/g, ' ').trim();
  if (!hasLetter(prose)) return '';
  // The virgule ("/ ") is the comma of Fraktur printing.
  const end = prose.slice(min).search(clause ? /[.!?,;:/](?:\s|$)/u : /[.!?](?:\s|$)/u);
  let cut = end === -1 ? prose.length : min + end + 1;
  if (cut > max) {
    const sp = prose.lastIndexOf(' ', max);
    cut = sp > min ? sp : max;
    return prose.slice(0, cut).trim() + ' …';
  }
  return prose.slice(0, cut).trim();
}
