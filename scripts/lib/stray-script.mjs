/**
 * PRIOR ART: scripts/lib/page-integrity.mjs `scriptCensus`-style counters (HAN_OR_KANA) and
 * scripts/lib/page-language.mjs `SCRIPTS` count a script's share of a whole page to guess its
 * LANGUAGE; neither asks whether a script belongs in an English translation, or where in the
 * markup it sits. scripts/audit/translation-bridging.mjs counts CJK in translations for a
 * different defect (untranslated source). src/lib/non-latin-scripts.ts maps a language LABEL to
 * "non-Latin?" only. None separates a gloss in a <note> from a stray token in running text.
 *
 * Stray scripts in an English translation (#5734). The Tibetan run (gemini-3-flash-preview,
 * 2026-10-01) wrote Korean 그 ("that") for the English word on 657 pages — "At 그 time a rain
 * of flowers fell" — and Chinese tokens (卓越 "excellent", 第九 "ninth") mid-sentence. No check
 * at the write asked whether a script in the English belonged there.
 *
 * The rule: a letter in an English translation is UNEXPECTED when
 *   - its script is not Latin (Common and Inherited — digits, punctuation, combining marks —
 *     are never letters of a script here), AND
 *   - the script does not occur in the page's source text (the OCR), nor belongs to the
 *     book's language label — a Greek word in the English of a Latin page that quotes Greek
 *     is the source showing through, not a stray, AND
 *   - it sits in running text, not inside a tag that legitimately carries original-script
 *     words (<note>, <term>, <gloss>, <unclear>, metadata tags; see CARRIER_TAGS).
 *
 * `repairStrayHangul` is the one MECHANICAL repair, for the one pattern measured (#5734): 그
 * followed by a space, or fused onto "at"/"hat" ("그at place", "그hat time"), is the English
 * "that"; 그 straight before "that" is dropped ("at 그 that time"), and 그 before another
 * determiner is left for a reader. It is applied only when Hangul is unexpected on the page —
 * a Korean source's English may quote 그 — and never touches any other Hangul.
 *
 * The write-time guard refuses on every script but Greek and Hebrew (GUARD_EXEMPT_SCRIPTS):
 * measured on the corpus scan, those two are mostly legitimate outside tags.
 *
 * TS twin: src/lib/stray-script.ts — kept byte-equivalent in behaviour by
 * tests/unit/stray-script-guard.test.ts, which runs both on the same fixtures.
 */

/** Tags whose content may legitimately be in the original script (a gloss, a quoted term, an
 *  echo of illegible source, metadata). Running text, headings, margins and captions are not here:
 *  those are translated text a reader reads as English. */
export const CARRIER_TAGS = [
  'note', 'term', 'gloss', 'unclear', 'warning', 'meta', 'vocab', 'summary', 'keywords',
  'lang', 'language', 'script', 'abbrev', 'image-desc', 'interp', 'lacuna', 'page-num', 'folio',
  'sig', 'header', 'columns', 'scan-quality', 'page-type',
];

/** The scripts the detector names. Anything else that is a letter and not Latin is 'Other'. */
export const SCRIPT_NAMES = [
  'Hangul', 'Han', 'Hiragana', 'Katakana', 'Greek', 'Cyrillic', 'Hebrew', 'Arabic', 'Syriac',
  'Tibetan', 'Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu',
  'Kannada', 'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Khmer', 'Myanmar', 'Mongolian', 'Armenian',
  'Georgian', 'Ethiopic', 'Coptic', 'Runic', 'Gothic', 'Cherokee', 'Javanese', 'Balinese',
  'Samaritan', 'Thaana', 'Tifinagh', 'Yi', 'Bopomofo', 'Egyptian_Hieroglyphs', 'Cuneiform', 'Avestan',
  'Phoenician', 'Old_Italic', 'Glagolitic', 'Ogham', 'Linear_B', 'Old_Persian', 'Ugaritic',
];
const SCRIPT_RES = SCRIPT_NAMES.map((s) => [s, new RegExp(`\\p{Script=${s}}`, 'u')]);
// Common and Inherited letters (µ, ℵ, ʿ, ʾ) belong to no script: the transliteration of Arabic
// writes ʿAlī, a botanist writes 3.5 µ. They are never stray.
const NON_LATIN_LETTER = /[^\P{L}\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;
const NON_LATIN_RUN = /[^\P{L}\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]+/gu;

/** Script name of one character, or null when it is Latin / not a letter. */
export function scriptOf(ch) {
  if (!NON_LATIN_LETTER.test(ch)) return null;
  for (const [name, re] of SCRIPT_RES) if (re.test(ch)) return name;
  return 'Other';
}

/** The set of non-Latin scripts whose letters occur in `text`. */
export function scriptsIn(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(NON_LATIN_RUN)) for (const ch of m[0]) out.add(scriptOf(ch));
  out.delete(null);
  return out;
}

// A book-language label → the scripts its source text is written in. Substring match on the
// lowercased label, so compound labels ("Classical Chinese / Japanese", "Hebrew and Aramaic")
// collect every script they name.
const LANGUAGE_SCRIPTS = [
  [/chinese|mandarin|cantonese|classical chinese/, ['Han']],
  [/japanese|kanbun/, ['Han', 'Hiragana', 'Katakana']],
  [/korean/, ['Hangul', 'Han']],
  [/vietnamese|chữ nôm|nom\b/, ['Han']],
  [/tibetan|dzongkha/, ['Tibetan']],
  [/greek/, ['Greek']],
  [/coptic/, ['Coptic', 'Greek']],
  [/hebrew|yiddish|ladino|aramaic|judeo/, ['Hebrew']],
  [/arabic|persian|farsi|urdu|ottoman|pashto|malay \(jawi\)|jawi/, ['Arabic']],
  [/syriac|aramaic/, ['Syriac']],
  [/russian|slavonic|ukrainian|bulgarian|serbian|belarusian|church slavic/, ['Cyrillic']],
  [/sanskrit|hindi|marathi|nepali|pali|prakrit/, ['Devanagari']],
  [/bengali|bangla/, ['Bengali']],
  [/tamil/, ['Tamil']],
  [/mongolian|manchu/, ['Mongolian', 'Cyrillic']],
  [/armenian/, ['Armenian']],
  [/georgian/, ['Georgian']],
  [/ethiopic|ge.ez|amharic|tigrinya/, ['Ethiopic']],
  [/thai/, ['Thai']],
  [/burmese|myanmar/, ['Myanmar']],
  [/khmer/, ['Khmer']],
  [/egyptian|demotic|hieratic|hieroglyph/, ['Egyptian_Hieroglyphs', 'Coptic']],
  [/gothic/, ['Gothic']],
  [/avestan/, ['Avestan']],
  [/akkadian|sumerian|hittite|babylonian|assyrian|cuneiform/, ['Cuneiform']],
  [/phoenician|punic/, ['Phoenician']],
  [/etruscan|oscan|umbrian/, ['Old_Italic']],
  [/ugaritic/, ['Ugaritic']],
  [/old persian/, ['Old_Persian']],
  [/glagolitic|old church slavonic/, ['Glagolitic', 'Cyrillic']],
];

/** Scripts a book-language label implies. */
export function scriptsOfLanguage(language) {
  const l = String(language || '').toLowerCase();
  const out = new Set();
  for (const [re, scripts] of LANGUAGE_SCRIPTS) if (re.test(l)) for (const s of scripts) out.add(s);
  return out;
}

const CARRIER_RE = new RegExp(`<(${CARRIER_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, 'gi');
const ANY_TAG = /<\/?[a-zA-Z][^<>]*>/g;

/** The translation with carrier-tag content and every tag (attributes included) blanked to
 *  spaces of the same length, so indices still point into the original text. */
export function runningText(text) {
  const blank = (m) => ' '.repeat(m.length);
  return String(text || '').replace(CARRIER_RE, blank).replace(ANY_TAG, blank);
}

/**
 * Letters in the running text of an English translation whose script is neither Latin nor
 * expected for this page (see the module comment).
 * @param {string} text  the translation
 * @param {{ ocr?: string, language?: string }} [ctx]  the page's source text; the book's language
 * @returns {Array<{ script: string, text: string, index: number }>}  one entry per run
 */
export function strayScripts(text, { ocr, language } = {}) {
  const run = runningText(text);
  if (!NON_LATIN_LETTER.test(run)) return [];
  const expected = new Set([...scriptsIn(ocr), ...scriptsOfLanguage(language)]);
  const out = [];
  // One entry per same-script run, by code point: "پασι" is an Arabic letter then Greek, and an
  // astral-plane letter (𓂀, 𐌰) is one character, not two halves of a surrogate pair.
  for (const m of run.matchAll(NON_LATIN_RUN)) {
    let at = m.index, cur = null;
    for (const ch of m[0]) {
      const script = scriptOf(ch);
      if (cur && cur.script === script) cur.text += ch;
      else { if (cur && !expected.has(cur.script)) out.push(cur); cur = { script, text: ch, index: at }; }
      at += ch.length;
    }
    if (cur && !expected.has(cur.script)) out.push(cur);
  }
  return out;
}

/**
 * Scripts the WRITE-TIME guard does not refuse on, though the scan still reports them. Measured
 * on the corpus scan (#5734, 5.4M English pages): Greek and Hebrew letters outside tags are mostly
 * legitimate — a variable in a mathematical text (β, γ, Δ), a manuscript siglum (א for Sinaiticus),
 * a quoted word the OCR transliterated. The other scripts were stray words in the samples read
 * (Persian سپس "then", Russian так "thus", Han 探究, Bengali তাঁর), so one letter is enough there.
 */
export const GUARD_EXEMPT_SCRIPTS = new Set(['Greek', 'Hebrew']);

/** The stray runs the write-time guard refuses on. */
export function guardStray(text, ctx = {}) {
  return strayScripts(text, ctx).filter((r) => !GUARD_EXEMPT_SCRIPTS.has(r.script));
}

// 그 then a space → "that "; 그 fused onto "at"/"hat" → "that" (#5734). At a sentence start the
// replacement is capitalised; nothing else is touched. 그 straight before "that" is the model
// writing the word twice ("at 그 that time"): 그 goes. Before another determiner ("even 그 the
// shadow") it is not "that" at all, and "그 그 that" is not one word either: those are left, and
// the page, with Hangul left over, goes to a reader.
const HANGUL_THAT = /그(?: that\b| (?!(?:the|this|these|those|a|an)\b|그)|h?at\b)/g;
const SENTENCE_START = /(?:^|[.!?]["'”’)\]]*\s+|\n\s*)$/;

/**
 * The mechanical repair for the measured Hangul pattern. Returns { text, count, other } where
 * `other` is the Hangul still left after it (a page with other Hangul needs a reader, not this).
 * A page whose source or language carries Hangul is returned untouched (count 0).
 */
export function repairStrayHangul(text, { ocr, language } = {}) {
  const src = String(text || '');
  if (!src.includes('그')) return { text: src, count: 0, other: hangulLeft(src) };
  const expected = new Set([...scriptsIn(ocr), ...scriptsOfLanguage(language)]);
  if (expected.has('Hangul')) return { text: src, count: 0, other: hangulLeft(src), expected: true };
  let count = 0;
  const out = src.replace(HANGUL_THAT, (m, offset) => {
    count++;
    const word = SENTENCE_START.test(src.slice(Math.max(0, offset - 6), offset)) ? 'That' : 'that';
    return m === '그 ' ? `${word} ` : word;
  });
  return { text: out, count, other: hangulLeft(out) };
}

function hangulLeft(text) {
  return (String(text).match(/\p{Script=Hangul}+/gu) || []);
}

/** The reason value stamped on `translation.health_blocked` for a refused stray-script page. */
export const STRAY_SCRIPT_REASON = 'stray-script';

/**
 * The write-time decision, shared by every translation writer (#5734). English only: a
 * translation into another language is not judged, and neither is a page whose source text is not
 * in hand (without it a Greek quotation in the English of a Latin page would read as stray).
 * Applies the mechanical Hangul repair first, then refuses when unexpected script is still left in
 * the running text.
 * @returns {{ text: string, refuse: boolean, reason?: string, stray: Array, repaired: number, judged: boolean }}
 */
export function strayScriptVerdict(text, { ocr, language, targetLanguage = 'English' } = {}) {
  const src = String(text || '');
  if (!src || !/^english$/i.test(String(targetLanguage || 'English'))) return { text: src, refuse: false, stray: [], repaired: 0, judged: false };
  if (typeof ocr !== 'string' || !ocr.trim()) return { text: src, refuse: false, stray: [], repaired: 0, judged: false };
  const fixed = repairStrayHangul(src, { ocr, language });
  const stray = guardStray(fixed.text, { ocr, language });
  return stray.length
    ? { text: fixed.text, refuse: true, reason: STRAY_SCRIPT_REASON, stray, repaired: fixed.count, judged: true }
    : { text: fixed.text, refuse: false, stray, repaired: fixed.count, judged: true };
}
