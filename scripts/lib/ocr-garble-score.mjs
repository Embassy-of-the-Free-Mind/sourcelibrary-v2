// PRIOR ART: scripts/lib/ocr-loop-guard.mjs — exact PERIODIC repetition only (reused here as
// the `loop` feature; it cannot see letter-soup, a filler token, or non-periodic block repeats).
// scripts/lib/page-integrity.mjs + block-drift.mjs — sourceProse (reused) and foldWord (a
// compare-fold that strips every mark, which collapses Indic and Tibetan words to consonant
// skeletons, so it is not usable as a dictionary key outside Latin/Greek). scripts/audit/
// detect-fabricated-ocr.mjs — fluent invented prose on a blank leaf; needs the image.
// src/lib/transcription-reliability.ts `pageReadCaution` (PR #5315) — reads the OCR's OWN
// <unclear>/<warning>; this file is for pages where the OCR admitted nothing.
// Nothing in scripts/lib, scripts/audit or scripts/eval/lib scores a page against a wordlist.
/**
 * ocr-garble-score — cheap per-page features for "is this OCR text garbled?" (#5313, T7/O4).
 *
 * No model, no image. Three families, as the issue specifies:
 *
 *   1. dictionary-hit rate — share of the page's UNITS found in a lexicon derived from the
 *      corpus itself (a unit seen in >= N distinct books; scripts/audit/ocr-garble-lexicon.mjs).
 *      A corpus-derived list, not a modern dictionary: early-modern spelling, scribal
 *      abbreviation and long-s forms are words here, and a modern wordlist would call a clean
 *      incunable garbage.
 *   2. token garbage — vowel-less tokens (Latin script), tokens mixing two scripts, runs of
 *      1–2 letter fragments.
 *   3. repetition — the exact periodic loop (ocr-loop-guard), non-periodic repeated n-grams
 *      (taxonomy O4), and a FILLER token: one unit that makes up a large share of the page at
 *      many times its corpus rate (`ᾗ ᾗ ᾗ`, one Han character in every line).
 *
 * A UNIT depends on the script, because a word is not a universal thing:
 *   - word scripts (Latin, Greek, Hebrew, Arabic, Devanagari, …): the folded word;
 *   - Tibetan: the syllable BIGRAM (every single syllable is "a word", so a lexicon of
 *     syllables cannot miss);
 *   - Han / kana / Hangul and the other unsegmented scripts: the character bigram.
 *
 * UNJUDGEABLE IS A VALUE (non-latin-text-operations.md). A page with too few units, or in a
 * script the lexicon has no entries for, returns `judged: false` with a reason. It is never a
 * clean page and never a garbled one.
 *
 * WHAT THIS CANNOT SEE. A model that fabricates fluent text writes real words in a plausible
 * order; every feature here reads that page as clean. That class (O1, O3) needs the image.
 */
import { sourceProse } from './block-drift.mjs';
import { loopVerdict } from './ocr-loop-guard.mjs';

// ── scripts ────────────────────────────────────────────────────────────────────────────────

// [from, to, script]. Sorted; looked up by binary search. Only letters reach this table.
const RANGES = [
  [0x0041, 0x024F, 'Latin'], [0x0250, 0x02AF, 'Latin'], [0x02B0, 0x02FF, 'Latin'],
  [0x0370, 0x03E1, 'Greek'], [0x03E2, 0x03EF, 'Coptic'], [0x03F0, 0x03FF, 'Greek'],
  [0x0400, 0x052F, 'Cyrillic'], [0x0531, 0x058F, 'Armenian'], [0x0591, 0x05FF, 'Hebrew'],
  [0x0600, 0x06FF, 'Arabic'], [0x0700, 0x074F, 'Syriac'], [0x0750, 0x077F, 'Arabic'],
  [0x0780, 0x07BF, 'Thaana'], [0x08A0, 0x08FF, 'Arabic'],
  [0x0900, 0x097F, 'Devanagari'], [0x0980, 0x09FF, 'Bengali'], [0x0A00, 0x0A7F, 'Gurmukhi'],
  [0x0A80, 0x0AFF, 'Gujarati'], [0x0B00, 0x0B7F, 'Oriya'], [0x0B80, 0x0BFF, 'Tamil'],
  [0x0C00, 0x0C7F, 'Telugu'], [0x0C80, 0x0CFF, 'Kannada'], [0x0D00, 0x0D7F, 'Malayalam'],
  [0x0D80, 0x0DFF, 'Sinhala'], [0x0E00, 0x0E7F, 'Thai'], [0x0E80, 0x0EFF, 'Lao'],
  [0x0F00, 0x0FFF, 'Tibetan'], [0x1000, 0x109F, 'Myanmar'], [0x10A0, 0x10FF, 'Georgian'],
  [0x1100, 0x11FF, 'Hangul'], [0x1200, 0x139F, 'Ethiopic'], [0x1780, 0x17FF, 'Khmer'],
  [0x1800, 0x18AF, 'Mongolian'], [0x1B00, 0x1B7F, 'Balinese'], [0x1C80, 0x1C8F, 'Cyrillic'],
  [0x1D00, 0x1DBF, 'Latin'], [0x1E00, 0x1EFF, 'Latin'], [0x1F00, 0x1FFF, 'Greek'],
  [0x2C60, 0x2C7F, 'Latin'], [0x2C80, 0x2CFF, 'Coptic'], [0x2D30, 0x2D7F, 'Tifinagh'],
  [0x2DE0, 0x2DFF, 'Cyrillic'], [0x2E80, 0x2FDF, 'Han'], [0x3005, 0x3007, 'Han'],
  [0x3040, 0x309F, 'Hiragana'], [0x30A0, 0x30FF, 'Katakana'], [0x3130, 0x318F, 'Hangul'],
  [0x31F0, 0x31FF, 'Katakana'], [0x3400, 0x4DBF, 'Han'], [0x4E00, 0x9FFF, 'Han'],
  [0xA640, 0xA69F, 'Cyrillic'], [0xA720, 0xA7FF, 'Latin'], [0xA980, 0xA9DF, 'Javanese'],
  [0xAB30, 0xAB6F, 'Latin'], [0xAC00, 0xD7AF, 'Hangul'], [0xF900, 0xFAFF, 'Han'],
  [0xFB00, 0xFB06, 'Latin'], [0xFB1D, 0xFB4F, 'Hebrew'], [0xFB50, 0xFDFF, 'Arabic'],
  [0xFE70, 0xFEFF, 'Arabic'], [0xFF21, 0xFF5A, 'Latin'], [0xFF66, 0xFF9F, 'Katakana'],
  [0x20000, 0x323AF, 'Han'],
];

/** Script of one letter's code point; `null` for marks, digits and anything unlisted. */
export function scriptOfCodePoint(cp) {
  if (cp < 0x41) return null;
  if (cp <= 0x7A) return (cp <= 0x5A || cp >= 0x61) ? 'Latin' : null;
  if (cp >= 0x0300 && cp <= 0x036F) return null; // combining diacritics inherit
  let lo = 0, hi = RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = RANGES[mid];
    if (cp < r[0]) hi = mid - 1; else if (cp > r[1]) lo = mid + 1; else return r[2];
  }
  return 'Other';
}

/** Han, kana and Hangul mix inside one word as a matter of course; they are one family. */
const CJK = new Set(['Han', 'Hiragana', 'Katakana', 'Hangul']);
/** Unsegmented scripts whose unit is a code-point n-gram inside the token. */
const SPACELESS = new Set(['Thai', 'Lao', 'Khmer', 'Myanmar']);
/** Scripts whose combining marks are optional diacritics, not part of the spelling. */
const STRIP_MARKS = new Set(['Latin', 'Greek', 'Hebrew', 'Arabic', 'Syriac', 'Coptic']);
/** Minimum folded length for a word to count toward the dictionary rate. Two-letter words hit
 *  any lexicon; in the abugidas a two-code-point token is already a full syllable or more. */
const MIN_WORD = { Latin: 3, Greek: 3, Cyrillic: 3, Armenian: 3, Georgian: 3, Coptic: 3, Hebrew: 3, Arabic: 3, Syriac: 3 };
const minWord = (script) => MIN_WORD[script] ?? 2;

export const familyOf = (script) => (CJK.has(script) ? 'CJK' : script);

/** Latin-script languages with their own lexicon, keyed by the catalogue's `language`. */
export const LATIN_LANGS = ['latin', 'english', 'german', 'french', 'italian', 'dutch', 'spanish'];
export function latinLangOf(language) {
  const l = String(language || '').trim().toLowerCase();
  return LATIN_LANGS.includes(l) ? l : null;
}

// ── tokens ─────────────────────────────────────────────────────────────────────────────────

const TOKEN_RE = /[\p{L}\p{M}]+/gu;
const ASCII_RE = /^[\x00-\x7F]*$/;
const MARK_RE = /\p{M}+/gu;
const LATIN_VOWEL_RE = /[aeiouyæœø]/;

/** Text the features read: tags and housekeeping removed, line-end hyphenation rejoined. */
export function garbleBody(ocr) {
  return sourceProse(String(ocr || '').replace(/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, ' '))
    .normalize('NFC')
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/([\p{L}\p{M}])[-‐¬⸗=]\s*\n\s*(?=[\p{Ll}\p{Lo}\p{M}])/gu, '$1');
}

function scriptsIn(tok) {
  let first = null, second = null;
  for (const ch of tok) {
    const s = scriptOfCodePoint(ch.codePointAt(0));
    if (!s) continue;
    const f = familyOf(s);
    if (first === null) first = f; else if (f !== first && second === null) second = f;
  }
  return [first, second];
}

/** Dictionary fold for one token of `script`. Both the lexicon and the scorer go through it. */
export function foldToken(tok, script) {
  if (script === 'Latin') {
    const t = ASCII_RE.test(tok) ? tok : tok.normalize('NFD').replace(MARK_RE, '');
    return t.toLowerCase().replace(/ſ/g, 's').replace(/v/g, 'u').replace(/j/g, 'i');
  }
  if (script === 'Greek') return tok.normalize('NFD').replace(MARK_RE, '').toLowerCase().replace(/ς/g, 'σ');
  if (script === 'Arabic') return tok.replace(MARK_RE, '').replace(/ـ/g, '');
  if (STRIP_MARKS.has(script)) return tok.normalize('NFD').replace(MARK_RE, '');
  return tok.toLowerCase();
}

/**
 * The page as tokens: `{ t: folded, s: family, mixed }` in reading order. Tokens made only of
 * combining marks (no letter) are dropped.
 */
export function tokensOf(body) {
  const out = [];
  for (const m of body.matchAll(TOKEN_RE)) {
    const [first, second] = scriptsIn(m[0]);
    if (first === null) continue;
    const t = foldToken(m[0], first);
    if (!t) continue;
    out.push({ t, s: first, mixed: second !== null });
  }
  return out;
}

/**
 * Dictionary units of a token stream, as `[key, unit]` pairs in order. `key` names the lexicon
 * file: the script family, and for bigram units the family plus `~2`.
 */
export function unitsOf(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const { t, s } = tokens[i];
    if (s === 'CJK') {
      const cps = Array.from(t);
      for (let k = 0; k + 1 < cps.length; k++) out.push(['CJK~2', cps[k] + cps[k + 1]]);
    } else if (s === 'Tibetan') {
      const next = tokens[i + 1];
      if (next && next.s === 'Tibetan') out.push(['Tibetan~2', t + '་' + next.t]);
    } else if (SPACELESS.has(s)) {
      const cps = Array.from(t);
      for (let k = 0; k + 2 < cps.length; k++) out.push([s + '~3', cps[k] + cps[k + 1] + cps[k + 2]]);
    } else if (Array.from(t).length >= minWord(s)) {
      out.push([s, t]);
    }
  }
  return out;
}

/** Unigrams for the filler test: words and Tibetan syllables as they are, CJK by character. */
export function unigramsOf(tokens) {
  const out = [];
  for (const { t, s } of tokens) {
    if (s === 'CJK') for (const ch of t) out.push(['CJK', ch]);
    else out.push([s, t]);
  }
  return out;
}

/** Everything the lexicon builder counts for one page: every unigram (any length, for the
 *  corpus rates the filler test needs) plus the n-gram units of the unsegmented scripts. */
export function lexiconUnitsOf(tokens) {
  return [...unigramsOf(tokens), ...unitsOf(tokens).filter(([k]) => k.includes('~'))];
}

// ── features ───────────────────────────────────────────────────────────────────────────────

/** Fewer dictionary units than this and the rate is noise: the page is unjudged. */
export const MIN_UNITS = 40;
/** A key needs this many lexicon entries before "not found" means anything. */
export const MIN_LEXICON = 2000;
/** Filler: a unit at least this many times over its corpus rate, and seen this often. */
const FILLER_RATIO = 15;
const FILLER_MIN_COUNT = 5;
const REPEAT_N = 5;
const FRAGMENT_RUN = 4;

/**
 * @param {string} ocr  the page's `ocr.data`
 * @param {object} opts
 * @param {{has(key:string, unit:string):boolean, size(key:string):number, rate(key:string, unit:string):number}} opts.lexicon
 * @param {string|null} [opts.language]  the book's catalogue language (Latin-script per-language rate)
 */
export function garbleFeatures(ocr, { lexicon, language = null } = {}) {
  const body = garbleBody(ocr);
  const tokens = tokensOf(body);
  const units = unitsOf(tokens);

  // Dominant script family by dictionary units.
  const byKey = new Map();
  for (const [k] of units) byKey.set(k, (byKey.get(k) || 0) + 1);
  let script = null, top = 0;
  for (const [k, n] of byKey) if (n > top) { top = n; script = k; }

  // 1. dictionary-hit rate, over units whose lexicon can judge them.
  let judgedUnits = 0, miss = 0, unjudgedUnits = 0;
  const lang = latinLangOf(language);
  const langKey = lang ? `Latin@${lang}` : null;
  const langUsable = langKey && lexicon.size(langKey) >= MIN_LEXICON;
  let langUnits = 0, langMiss = 0;
  for (const [k, u] of units) {
    if (lexicon.size(k) < MIN_LEXICON) { unjudgedUnits++; continue; }
    judgedUnits++;
    const hit = lexicon.has(k, u);
    if (!hit) miss++;
    if (k === 'Latin' && langUsable) { langUnits++; if (!lexicon.has(langKey, u)) langMiss++; }
  }

  // 2. token garbage.
  const n = tokens.length;
  let mixed = 0, latinLong = 0, noVowel = 0, fragTokens = 0, run = 0;
  const closeRun = () => { if (run >= FRAGMENT_RUN) fragTokens += run; run = 0; };
  for (const { t, s, mixed: mx } of tokens) {
    if (mx) mixed++;
    if (s === 'Latin' && t.length >= 3) { latinLong++; if (!LATIN_VOWEL_RE.test(t)) noVowel++; }
    if (s !== 'CJK' && s !== 'Tibetan' && !SPACELESS.has(s) && Array.from(t).length <= 2) run++; else closeRun();
  }
  closeRun();

  // 3. repetition.
  const uni = unigramsOf(tokens);
  const counts = new Map();
  for (const [k, u] of uni) { const id = k + '\t' + u; counts.set(id, (counts.get(id) || 0) + 1); }
  let filler = 0, fillerUnit = null;
  for (const [id, c] of counts) {
    if (c < FILLER_MIN_COUNT) continue;
    const share = c / uni.length;
    if (share <= filler) continue;
    const tab = id.indexOf('\t');
    const key = id.slice(0, tab), unit = id.slice(tab + 1);
    // A Latin-script word's rate is its rate in THIS language where we have one: pooled over
    // every Latin-script language, German `der` looks ten times rarer than it is in German.
    const expected = Math.max(lexicon.rate(key, unit), key === 'Latin' && langUsable ? lexicon.rate(langKey, unit) : 0);
    if (share >= FILLER_RATIO * expected) { filler = share; fillerUnit = id.slice(tab + 1); }
  }
  let repeated = 0;
  if (uni.length >= REPEAT_N * 4) {
    const seen = new Set();
    const covered = new Uint8Array(uni.length);
    for (let i = 0; i + REPEAT_N <= uni.length; i++) {
      let g = '';
      for (let k = 0; k < REPEAT_N; k++) g += uni[i + k][1] + '\u0001';
      if (seen.has(g)) for (let k = 0; k < REPEAT_N; k++) covered[i + k] = 1; else seen.add(g);
    }
    for (const c of covered) repeated += c;
  }
  const loop = loopVerdict(ocr);

  const f = {
    judged: true, why: null, script, tokens: n, units: judgedUnits,
    oov: judgedUnits ? miss / judgedUnits : null,
    oov_lang: langUnits >= MIN_UNITS ? langMiss / langUnits : null,
    no_vowel: latinLong >= MIN_UNITS ? noVowel / latinLong : null,
    mixed: n ? mixed / n : 0,
    fragment: n ? fragTokens / n : 0,
    filler, filler_unit: fillerUnit,
    repeat: uni.length ? repeated / uni.length : 0,
    loop: loop.share || 0,
  };
  if (judgedUnits < MIN_UNITS) {
    f.judged = false;
    f.why = units.length < MIN_UNITS ? 'too_few_units' : 'no_lexicon_for_script';
    f.oov = null;
  }
  return f;
}

// ── what the OCR already admitted ──────────────────────────────────────────────────────────

const NON_BODY_RE = /<(language|script|page-type|columns|meta|vocab|header|page-num|sig|image-desc|warning|summary|keywords)[^>]*>[\s\S]*?<\/\1>/gi;
const READ_HARM_RE = /illegib|unreadab|barely legib|partially legib|difficult to (read|decipher|make out)|hard to (read|decipher|make out)|impossible to (read|decipher)|cannot be (read|deciphered)|loss of (the |[a-z]+ and )?(text|characters|letters|words|lines)|partially lost|text (is|has been|was) lost|lost text|obscur\w* (some |the |portions of |parts of |much of |most of |several )?(the )?(main |primary )?(text|characters|letters|words|lines|passages)|imped\w* legib|severely faded|heavily faded|significantly faded/i;
const STILL_LEGIBLE_RE = /(remains?|still|is|are|fully|clearly|otherwise) (clear and |largely |mostly |generally )?legible/i;

/**
 * The two signals the reader note already fires on — a copy of `pageReadCaution`
 * (src/lib/transcription-reliability.ts, PR #5315), kept here only so a corpus walk can count
 * how many garble-flagged pages the note ALREADY reaches. If that function changes, change
 * this; if the detector is ever wired into the reader, delete this and import that.
 */
export function ocrSelfCaution(ocr) {
  const body = String(ocr || '').replace(NON_BODY_RE, '');
  const plainLen = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length;
  if (plainLen >= 60) {
    let unclear = 0;
    for (const m of body.matchAll(/<unclear[^>]*>([\s\S]*?)<\/unclear>/gi)) {
      unclear += m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length;
    }
    if (unclear / plainLen >= 0.1) return 'unclear';
  }
  const warning = String(ocr || '').match(/<warning>([\s\S]*?)<\/warning>/i)?.[1];
  if (warning && READ_HARM_RE.test(warning) && !STILL_LEGIBLE_RE.test(warning)) return 'damage';
  return null;
}

// ── lexicon ────────────────────────────────────────────────────────────────────────────────

/** File name for a lexicon key (`CJK~2`, `Latin@german`, `Greek`). */
export const lexiconFile = (key) => key.replace(/[^A-Za-z0-9@~_-]/g, '_') + '.tsv';

/**
 * In-memory lexicon from `{ key: Iterable<[unit, bookFreq, tokenFreq]> }`.
 * `minBooks` is the membership floor; `totals[key]` the key's total token count (for rates).
 */
export function makeLexicon(entries, { minBooks = 3, totals = {} } = {}) {
  const sets = new Map(), rates = new Map();
  for (const [key, rows] of Object.entries(entries)) {
    const set = new Set(), rate = new Map();
    const total = totals[key] || 0;
    for (const [unit, bf, tf] of rows) {
      if (bf >= minBooks) set.add(unit);
      if (total && tf / total >= 1e-4) rate.set(unit, tf / total);
    }
    sets.set(key, set); rates.set(key, rate);
  }
  return {
    has: (key, unit) => sets.get(key)?.has(unit) ?? false,
    size: (key) => sets.get(key)?.size ?? 0,
    // Units below 1e-4 of the corpus are all "rare"; the floor keeps the ratio finite.
    rate: (key, unit) => rates.get(key)?.get(unit) ?? 1e-4,
    keys: () => [...sets.keys()],
  };
}

/**
 * Load the lexicon directory written by scripts/audit/ocr-garble-lexicon.mjs
 * (`<key>.tsv` rows of `unit \t books \t tokens`, plus `_meta.json`).
 */
export async function loadLexiconDir(dir, { minBooks = 3 } = {}) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8'));
  const entries = {};
  for (const key of Object.keys(meta.keys)) {
    const rows = [];
    const text = fs.readFileSync(path.join(dir, lexiconFile(key)), 'utf8');
    let at = 0;
    while (at < text.length) {
      let nl = text.indexOf('\n', at); if (nl < 0) nl = text.length;
      const line = text.slice(at, nl); at = nl + 1;
      const a = line.indexOf('\t'), b = line.indexOf('\t', a + 1);
      if (a < 0 || b < 0) continue;
      rows.push([line.slice(0, a), +line.slice(a + 1, b), +line.slice(b + 1)]);
    }
    entries[key] = rows;
  }
  const totals = Object.fromEntries(Object.entries(meta.keys).map(([k, v]) => [k, v.tokens]));
  return Object.assign(makeLexicon(entries, { minBooks, totals }), { meta });
}
