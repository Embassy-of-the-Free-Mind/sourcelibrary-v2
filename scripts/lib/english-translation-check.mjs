/**
 * PRIOR ART: scripts/lib/language-content-classify.mjs — the stopword/script densities used here
 * (reused, not copied). scripts/lib/stray-script.mjs — a stray non-Latin LETTER inside an English
 * translation; a different defect (right language, wrong script runs), and it cannot see German
 * or Latin, which are Latin-script. scripts/audit/translation-bridging.mjs — untranslated CJK
 * left in the English. scripts/lib/page-language.mjs — reads OCR `<language>` tags, i.e. the
 * SOURCE side; this file reads the TRANSLATION side.
 *
 * Does a page whose `translation.language` claims English actually contain English? (#4937)
 *
 * `scripts/import/oraec-paginate-translate.mjs` wrote the German source into `translation.data`
 * labelled `language: en` on every failed call, for months (#4936). Nothing read the text back.
 * The write side is fixed; this is the read-side check the label never had.
 *
 * The instrument is the stopword classifier, so it inherits its blind spot: it can only name
 * Latin-script European languages plus Greek and Cyrillic. That is enough for THIS question:
 * English is one of the languages it reads, so "English stopwords are not the dominant signal"
 * is meaningful whatever else the page is. A page in a non-Latin script reads as near-zero
 * English density AND a low Latin-letter share, which is reported separately (`script`).
 *
 * Conservative by design: a page is judged only with enough words, and a book is flagged only
 * when several sampled pages agree. English translations of Latin works legitimately quote the
 * Latin, and a single short page of quotation is not a mislabel.
 */
import { classifyLanguageContent, stripOcrMetadata, formatDetectedLanguage } from './language-content-classify.mjs';

/** Below this many words a page's stopword density is noise, not evidence. */
export const MIN_WORDS = 40;
/** English density below this share of the dominant language's density = not English. */
export const ENGLISH_RATIO = 0.5;
/** Latin letters below this share of all letters = the page is not Latin-script text at all. */
export const MIN_LATIN_SHARE = 0.5;
/** A book is flagged when at least this many judged pages, and this share of them, are not English. */
export const MIN_BAD_PAGES = 2;
export const BAD_SHARE = 0.3;

/**
 * Tags whose content is the ORIGINAL's words by design (subset of stray-script.mjs CARRIER_TAGS).
 * `gloss` and `note` are deliberately absent: they carry the translator's English. Measured: a
 * Greek–Latin NT lexicon's English (`<term>Ἀποκλαίω</term> <gloss>I bewail</gloss>`) read as
 * Greek until the terms were dropped (#4937 sweep, 2026-10-11).
 */
const SOURCE_CARRIERS = /<(term|unclear|lang|abbrev|interp|lacuna)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Labels that claim English. An absent label is the pipeline's default, which is also English. */
export function claimsEnglish(label) {
  if (label == null || label === '') return true;
  return /^(en|eng|english)$/i.test(String(label).trim());
}

/**
 * Judge one translation text. Returns `{ verdict, detected, words, english, top, latinShare }`
 * where verdict is 'english' | 'not-english' | 'script' | 'thin'.
 *
 * `detected` is the NEAREST of the classifier's seven stopword languages, not an identification:
 * untranslated Pali in the Dhammapada reads as "Italian". Trust the verdict, not the name.
 */
export function judgeTranslationPage(text) {
  text = String(text || '').replace(SOURCE_CARRIERS, ' ');
  const body = stripOcrMetadata(text);
  const letters = (body.match(/\p{L}/gu) || []).length;
  const latin = (body.match(/\p{Script=Latin}/gu) || []).length;
  const latinShare = letters ? latin / letters : 0;
  if (letters >= 200 && latinShare < MIN_LATIN_SHARE) {
    return { verdict: 'script', detected: null, words: 0, english: 0, top: 0, latinShare };
  }
  const r = classifyLanguageContent(text);
  const english = r.dens.english || 0;
  const out = { detected: formatDetectedLanguage(r.dominant), words: r.words, english, top: r.score, latinShare };
  if (r.words < MIN_WORDS) return { verdict: 'thin', ...out };
  if (r.dominant === 'english' || english >= ENGLISH_RATIO * r.score) return { verdict: 'english', ...out };
  return { verdict: 'not-english', ...out };
}

/**
 * Judge a book from a sample of page texts. `flagged` is true when the sample says the
 * English label is wrong on more than an incidental page.
 */
export function judgeTranslationSample(texts) {
  const pages = texts.map(judgeTranslationPage);
  const judged = pages.filter((p) => p.verdict !== 'thin');
  const bad = judged.filter((p) => p.verdict === 'not-english' || p.verdict === 'script');
  const detected = {};
  for (const p of bad) {
    const k = p.verdict === 'script' ? '(non-Latin script)' : p.detected;
    detected[k] = (detected[k] || 0) + 1;
  }
  const share = judged.length ? bad.length / judged.length : 0;
  return {
    sampled: pages.length,
    judged: judged.length,
    bad: bad.length,
    share,
    detected,
    flagged: bad.length >= MIN_BAD_PAGES && share >= BAD_SHARE,
    pages,
  };
}
