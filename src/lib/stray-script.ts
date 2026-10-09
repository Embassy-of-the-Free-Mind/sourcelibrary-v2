/**
 * PRIOR ART: scripts/lib/stray-script.mjs — this is its TS twin, for the app-side translation
 * writers (Lambda, batch-translate-async, batch-save, /api/process, contribute). Behaviour is
 * pinned to the .mjs by tests/unit/stray-script-guard.test.ts, which runs both on the same
 * fixtures. src/lib/non-latin-scripts.ts maps a language LABEL to "non-Latin?" only.
 *
 * Stray scripts in an English translation (#5734): the Tibetan run wrote Korean 그 ("that") and
 * Chinese tokens (卓越, 第九) into the English. A letter is UNEXPECTED when its script is not Latin,
 * does not occur in the page's source text (OCR) nor belong to the book's language, and sits in
 * running text rather than in a tag that carries original-script words (CARRIER_TAGS). The one
 * mechanical repair is 그 + space / 그at / 그hat → "that"; everything else is refused at the write.
 * The full rationale is in the .mjs.
 */

export const CARRIER_TAGS = [
  'note', 'term', 'gloss', 'unclear', 'warning', 'meta', 'vocab', 'summary', 'keywords',
  'lang', 'language', 'script', 'abbrev', 'image-desc', 'interp', 'lacuna', 'page-num', 'folio',
  'sig', 'header', 'columns', 'scan-quality', 'page-type',
];

export const SCRIPT_NAMES = [
  'Hangul', 'Han', 'Hiragana', 'Katakana', 'Greek', 'Cyrillic', 'Hebrew', 'Arabic', 'Syriac',
  'Tibetan', 'Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu',
  'Kannada', 'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Khmer', 'Myanmar', 'Mongolian', 'Armenian',
  'Georgian', 'Ethiopic', 'Coptic', 'Runic', 'Gothic', 'Cherokee', 'Javanese', 'Balinese',
  'Samaritan', 'Thaana', 'Tifinagh', 'Yi', 'Bopomofo', 'Egyptian_Hieroglyphs', 'Cuneiform', 'Avestan',
  'Phoenician', 'Old_Italic', 'Glagolitic', 'Ogham', 'Linear_B', 'Old_Persian', 'Ugaritic',
];
const SCRIPT_RES: Array<[string, RegExp]> = SCRIPT_NAMES.map((s) => [s, new RegExp(`\\p{Script=${s}}`, 'u')]);
const NON_LATIN_LETTER = new RegExp('[^\\P{L}\\p{Script=Latin}\\p{Script=Common}\\p{Script=Inherited}]', 'u');
const NON_LATIN_RUN = new RegExp('[^\\P{L}\\p{Script=Latin}\\p{Script=Common}\\p{Script=Inherited}]+', 'gu');

export function scriptOf(ch: string): string | null {
  if (!NON_LATIN_LETTER.test(ch)) return null;
  for (const [name, re] of SCRIPT_RES) if (re.test(ch)) return name;
  return 'Other';
}

export function scriptsIn(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const m of String(text || '').matchAll(NON_LATIN_RUN)) for (const ch of m[0]) { const s = scriptOf(ch); if (s) out.add(s); }
  return out;
}

const LANGUAGE_SCRIPTS: Array<[RegExp, string[]]> = [
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

export function scriptsOfLanguage(language: string | null | undefined): Set<string> {
  const l = String(language || '').toLowerCase();
  const out = new Set<string>();
  for (const [re, scripts] of LANGUAGE_SCRIPTS) if (re.test(l)) for (const s of scripts) out.add(s);
  return out;
}

const CARRIER_RE = new RegExp(`<(${CARRIER_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, 'gi');
const ANY_TAG = /<\/?[a-zA-Z][^<>]*>/g;

export function runningText(text: string | null | undefined): string {
  const blank = (m: string) => ' '.repeat(m.length);
  return String(text || '').replace(CARRIER_RE, blank).replace(ANY_TAG, blank);
}

export interface StrayRun { script: string; text: string; index: number }
interface Ctx { ocr?: string | null; language?: string | null }

export function strayScripts(text: string | null | undefined, { ocr, language }: Ctx = {}): StrayRun[] {
  const run = runningText(text);
  if (!NON_LATIN_LETTER.test(run)) return [];
  const expected = new Set([...scriptsIn(ocr), ...scriptsOfLanguage(language)]);
  const out: StrayRun[] = [];
  for (const m of run.matchAll(NON_LATIN_RUN)) {
    let at = m.index as number;
    let cur: StrayRun | null = null;
    for (const ch of m[0]) {
      const script = scriptOf(ch) as string;
      if (cur && cur.script === script) cur.text += ch;
      else { if (cur && !expected.has(cur.script)) out.push(cur); cur = { script, text: ch, index: at }; }
      at += ch.length;
    }
    if (cur && !expected.has(cur.script)) out.push(cur);
  }
  return out;
}

/** Scripts the write-time guard does not refuse on (measured; see the .mjs). */
export const GUARD_EXEMPT_SCRIPTS = new Set(['Greek', 'Hebrew']);

export function guardStray(text: string | null | undefined, ctx: Ctx = {}): StrayRun[] {
  return strayScripts(text, ctx).filter((r) => !GUARD_EXEMPT_SCRIPTS.has(r.script));
}

// 그 straight before "that" is the model writing the word twice ("at 그 that time"): 그 goes. Before
// another determiner ("even 그 the shadow") it is not "that" at all, and "그 그 that" is not one
// word either: those are left, and the page, with Hangul left over, goes to a reader.
const HANGUL_THAT = /그(?: that\b| (?!(?:the|this|these|those|a|an)\b|그)|h?at\b)/g;
const SENTENCE_START = /(?:^|[.!?]["'”’)\]]*\s+|\n\s*)$/;
const hangulLeft = (text: string) => String(text).match(/\p{Script=Hangul}+/gu) || [];

export function repairStrayHangul(text: string | null | undefined, { ocr, language }: Ctx = {}): { text: string; count: number; other: string[]; expected?: boolean } {
  const src = String(text || '');
  if (!src.includes('그')) return { text: src, count: 0, other: hangulLeft(src) };
  const expected = new Set([...scriptsIn(ocr), ...scriptsOfLanguage(language)]);
  if (expected.has('Hangul')) return { text: src, count: 0, other: hangulLeft(src), expected: true };
  let count = 0;
  const out = src.replace(HANGUL_THAT, (m: string, offset: number) => {
    count++;
    const word = SENTENCE_START.test(src.slice(Math.max(0, offset - 6), offset)) ? 'That' : 'that';
    return m === '그 ' ? `${word} ` : word;
  });
  return { text: out, count, other: hangulLeft(out) };
}

export const STRAY_SCRIPT_REASON = 'stray-script';

export interface StrayScriptVerdict { text: string; refuse: boolean; reason?: string; stray: StrayRun[]; repaired: number; judged: boolean }

export function strayScriptVerdict(text: string | null | undefined, { ocr, language, targetLanguage = 'English' }: Ctx & { targetLanguage?: string | null } = {}): StrayScriptVerdict {
  const src = String(text || '');
  if (!src || !/^english$/i.test(String(targetLanguage || 'English'))) return { text: src, refuse: false, stray: [], repaired: 0, judged: false };
  if (typeof ocr !== 'string' || !ocr.trim()) return { text: src, refuse: false, stray: [], repaired: 0, judged: false };
  const fixed = repairStrayHangul(src, { ocr, language });
  const stray = guardStray(fixed.text, { ocr, language });
  return stray.length
    ? { text: fixed.text, refuse: true, reason: STRAY_SCRIPT_REASON, stray, repaired: fixed.count, judged: true }
    : { text: fixed.text, refuse: false, stray, repaired: fixed.count, judged: true };
}
