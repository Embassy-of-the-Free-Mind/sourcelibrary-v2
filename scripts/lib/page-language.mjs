/**
 * PRIOR ART: scripts/audit/ft-english-badged-classify.mjs — the sampling + tag + script-census
 * instrument this generalises, and the source of every constant below. That script answers ONE
 * binary question (is a first-translation-badged book really English?) and writes nothing; it is
 * load-bearing for badge adjudication, so it is deliberately left untouched and keeps its own copy
 * of these helpers. This file is the GENERAL form — "which language is this book?" — for import and
 * maintenance callers. Keep the primitives in sync with that script; they encode two measured traps
 * and drift would silently undo both.
 *
 * Normalisation is delegated to scripts/lib/language-normalize.mjs (pinned twin of the TS module,
 * held by tests/unit/language-normalize-parity.test.ts). Do NOT hand-roll a code map here — an
 * ad-hoc one that knew 3-letter codes but not 2-letter ones reported 30 false language conflicts
 * on the 2026-09-09 acquisition wave before anyone checked.
 *
 * WHY THIS EXISTS. `books.language` decides the OCR model: getModelForBook() in
 * src/lib/types/ai-models.ts sends Latin-script languages to flash-lite and everything else
 * (including unknown) to full flash. A book mis-catalogued as English therefore buys the wrong
 * model for its whole run. Catalogued metadata is wrong often enough to matter — on the books where
 * IA publishes its own `ocr_detected_lang` we could check 42 and 5 disagreed, the OCR right every
 * time. Page text is the empirical signal; see src/lib/resolve-language.ts for why empirical
 * signals outrank the caller.
 *
 * See .claude/docs/invariants/language-fields.md — `language` is the EDITION's language, never the
 * work's. This module answers only the edition question.
 */
import { normalizeLanguageToken, languageFamily } from './language-normalize.mjs';

/** A page with less OCR than this is a plate, a blank or a flyleaf — not evidence of a language. */
export const MIN_CONTENT_CHARS = 700;
/** Skip this share of content pages at the front (title page, preface, introduction). */
export const SKIP_FRONT = 0.15;
/** Skip this share at the back (indices, colophons, publisher's advertisements). */
export const SKIP_BACK = 0.05;
/** Body-text non-Latin characters above this mean the text is genuinely not a Latin-script language. */
export const NONLATIN_REAL = 2000;
/** Between this and NONLATIN_REAL: quotation-scale. Report, never auto-apply. */
export const NONLATIN_QUOTE = 400;
/** Below this many sampled content pages, the answer is "we don't know", never a language. */
export const MIN_SAMPLE = 4;
/** Share of the sample that must carry one tag before it is written unreviewed. */
export const CLEAR_SHARE = 0.7;
/**
 * A runner-up language holding at least this share means the sample saw TWO languages, which is
 * what a parallel-text edition looks like — Budge's Bar Hebraeus (Syriac facing English), Bleek &
 * Lloyd's Specimens (ǀXam facing English), Gorfinkle's Maimonides (Hebrew facing English). Choosing
 * one of the two is an editorial judgement about what the edition IS, so it goes to a human.
 */
export const BILINGUAL_RUNNERUP = 0.25;
/**
 * A language token must look like a language name before it is written to a reader-facing field.
 * The OCR emitted "|xam" for Specimens of Bushman Folklore — a real language (ǀXam) under a
 * non-alphabetic transcription that no downstream consumer knows.
 */
const WELL_FORMED = /^[A-Za-z][A-Za-z \-']{2,}$/;

export const SCRIPTS = [
  ['HEBREW', /[֐-׿]/g],
  ['ARABIC', /[؀-ۿݐ-ݿ]/g],
  ['GREEK', /[Ͱ-Ͽἀ-῿]/g],
  ['CYRILLIC', /[Ѐ-ӿ]/g],
  ['CJK', /[぀-ヿ一-鿿]/g],
  ['DEVANAGARI', /[ऀ-ॿ]/g],
  ['TIBETAN', /[ༀ-࿿]/g],
  ['ARMENIAN', /[԰-֏]/g],
  ['MALAYALAM', /[ഀ-ൿ]/g],
  ['SYRIAC', /[܀-ݏ]/g],
];

/** Script -> the language we may assert from script alone. Absent = script is ambiguous. */
const SCRIPT_LANGUAGE = { HEBREW: 'Hebrew', GREEK: 'Greek', ARMENIAN: 'Armenian', SYRIAC: 'Syriac', TIBETAN: 'Tibetan' };

/** Tags the OCR emits when it could not read a language off the page. Never a vote. */
const NULL_TAGS = new Set(['none', 'n/a', 'na', 'null', 'unknown', 'undetermined', 'illegible', '-', '']);

/**
 * `pages.ocr` is an OBJECT — `{ data, model, prompt_hash, … }` — not a string. Coercing it with
 * String() yields "[object Object]" (15 chars), which silently fails every length filter and
 * reports a clean, wrong "no content pages" for the whole corpus. Always read `.data`.
 */
export function ocrText(ocr) {
  if (typeof ocr === 'string') return ocr;
  if (ocr && typeof ocr.data === 'string') return ocr.data;
  return '';
}

/** Strip the OCR markup so a `<language>English</language>` tag cannot be counted as body text. */
export function bodyText(ocr) {
  return ocrText(ocr).replace(/<[^>]*>/g, ' ');
}

/** The language the OCR model itself reported for this page, or null. */
export function languageTag(ocr) {
  const m = ocrText(ocr).match(/<language>\s*([^<]+?)\s*<\/language>/i);
  if (!m) return null;
  const tag = m[1].trim().toLowerCase();
  return NULL_TAGS.has(tag) ? null : tag;
}

export function scriptCensus(text) {
  const out = {};
  for (const [name, re] of SCRIPTS) {
    const n = (text.match(re) || []).length;
    if (n > 0) out[name] = n;
  }
  return out;
}

/**
 * Take `n` items spread evenly across the interior. Front and back matter are trimmed FIRST,
 * because that is where an edition's apparatus lives and the interior is where its text lives.
 * Sampling the first N content pages measures the apparatus: the first dozen content pages of
 * Quignones' Breviarium Romanum, Feltoe's Sacramentarium Leonianum and Little's Opus Tertium all
 * read English while pages 112, 113 and 63 are solidly Latin (#3524 — it nearly demoted three
 * legitimate badges). For a short item there is no interior to speak of, so fall back to the whole
 * set rather than return none.
 */
export function spreadSample(items, n) {
  if (items.length <= n) return items;
  const from = Math.floor(items.length * SKIP_FRONT);
  const to = Math.ceil(items.length * (1 - SKIP_BACK));
  const interior = items.slice(from, to);
  const pool = interior.length >= n ? interior : items;
  const step = pool.length / n;
  return Array.from({ length: n }, (_, i) => pool[Math.floor(i * step)]);
}

/**
 * Decide an edition's language from its page text.
 *
 * @param {Array<{ocr?: any, page_number?: number}>} pages  pages carrying OCR (any order)
 * @param {{sample?: number}} [opts]
 * @param {string|null} [storedLanguage]  what the catalogue currently says, so a same-family
 *        refinement ("German" -> "Middle High German") can be reported as agreement rather than a
 *        correction. It is not one: it is more precise about the same language, and writing it would
 *        also push the book off getModelForBook()'s Latin-script list and onto the dearer model.
 * @returns {{language: string|null, confidence: 'clear'|'review'|'none'|'refinement', sampled: number,
 *            modal: string|null, modalShare: number, scripts: object, why: string}}
 */
export function detectLanguageFromPages(pages, opts = {}, storedLanguage = null) {
  const sample = opts.sample ?? 25;
  const content = pages
    .filter(p => bodyText(p.ocr).trim().length >= MIN_CONTENT_CHARS)
    .sort((a, b) => (a.page_number || 0) - (b.page_number || 0));
  const picked = spreadSample(content, sample);
  const sampled = picked.length;
  if (sampled === 0) return { language: null, confidence: 'none', sampled: 0, modal: null, modalShare: 0, scripts: {}, why: 'no content pages with OCR' };

  const votes = {};
  for (const p of picked) {
    const t = languageTag(p.ocr);
    if (t) votes[t] = (votes[t] || 0) + 1;
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const modal = ranked.length ? ranked[0][0] : null;
  const modalCount = ranked.length ? ranked[0][1] : 0;
  const modalShare = sampled ? modalCount / sampled : 0;

  const scripts = scriptCensus(picked.map(p => bodyText(p.ocr)).join(' '));
  const nonLatin = Object.entries(scripts).sort((a, b) => b[1] - a[1]);
  const nonLatinTotal = nonLatin.reduce((s, [, n]) => s + n, 0);
  const modalLang = modal ? normalizeLanguageToken(modal) : null;
  const stored = storedLanguage ? normalizeLanguageToken(storedLanguage) : null;
  const runnerUpShare = ranked.length > 1 ? ranked[1][1] / sampled : 0;
  const base = { sampled, modal, modalShare, scripts };

  // A refinement inside one language family is not a correction, so it must not overwrite.
  if (modalLang && stored && modalLang !== stored && languageFamily(modalLang) === languageFamily(stored)) {
    return { ...base, language: stored, confidence: 'refinement', why: `page text reads "${modalLang}" — the same family as the stored "${stored}", a finer label rather than a different language` };
  }
  // Two languages in one sample is a parallel-text edition; which one the edition "is" needs a human.
  if (modalLang && runnerUpShare >= BILINGUAL_RUNNERUP) {
    return { ...base, language: modalLang, confidence: 'review', why: `two languages in the sample — "${modal}" ${Math.round(modalShare * 100)}% and "${ranked[1][0]}" ${Math.round(runnerUpShare * 100)}%: a parallel-text edition` };
  }
  // Never write a token that does not read as a language name.
  if (modalLang && !WELL_FORMED.test(modalLang)) {
    return { ...base, language: modalLang, confidence: 'review', why: `the OCR reported "${modalLang}", which is not a well-formed language name — confirm the intended label` };
  }

  // A heavy non-Latin script VETOES a Latin-script tag: that combination is the known
  // apparatus-vs-text failure, where the model reads the editor's English and calls the book English.
  if (nonLatinTotal >= NONLATIN_REAL && nonLatin.length) {
    const [topScript, topCount] = nonLatin[0];
    const fromScript = SCRIPT_LANGUAGE[topScript] || null;
    const modalAgrees = modalLang && fromScript && modalLang === fromScript;
    if (modalAgrees) return { language: modalLang, confidence: 'clear', sampled, modal, modalShare, scripts, why: `${topCount} ${topScript} chars and the OCR tag agrees` };
    // Script is decisive about the writing system but often not about the language
    // (Devanagari: Sanskrit or Hindi or Marathi; CJK: Chinese or Japanese). Never guess across that.
    if (fromScript) return { language: fromScript, confidence: 'review', sampled, modal, modalShare, scripts, why: `${topCount} ${topScript} chars but the OCR tag says "${modal ?? 'none'}" — script wins, confirm the language` };
    return { language: null, confidence: 'review', sampled, modal, modalShare, scripts, why: `${topCount} ${topScript} chars; that script does not name one language — needs a human` };
  }

  if (!modalLang) return { language: null, confidence: 'none', sampled, modal, modalShare, scripts, why: 'no page reported a language' };
  if (sampled < MIN_SAMPLE) return { language: modalLang, confidence: 'review', sampled, modal, modalShare, scripts, why: `only ${sampled} content page(s) — too thin to write unreviewed` };
  if (modalShare < CLEAR_SHARE) return { language: modalLang, confidence: 'review', sampled, modal, modalShare, scripts, why: `modal "${modal}" on only ${modalCount}/${sampled} pages` };
  if (nonLatinTotal >= NONLATIN_QUOTE) return { language: modalLang, confidence: 'review', sampled, modal, modalShare, scripts, why: `modal "${modal}" ${modalCount}/${sampled}, but ${nonLatinTotal} non-Latin chars — check it is quotation, not the text` };
  return { language: modalLang, confidence: 'clear', sampled, modal, modalShare, scripts, why: `modal "${modal}" on ${modalCount}/${sampled} content pages` };
}
