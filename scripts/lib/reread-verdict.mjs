/**
 * PRIOR ART: scripts/lib/ocr-loop-guard.mjs (`loopVerdict`, the write-time gate) and
 * scripts/lib/page-integrity.mjs (`repeatedBlocks`, the O4 check) are reused here, not
 * re-implemented. Neither alone is the bar a RE-READ must clear: the gate deliberately
 * passes repeats that vary (litanies), and the #3878 pilot's near-loop varied by one
 * token per repeat. scripts/lib/page-integrity.mjs `dominantScript` and
 * scripts/lib/page-language.mjs `scriptCensus` cover ten scripts and no Javanese,
 * Buginese, Balinese, Myanmar, Tangut or Ethiopic — the scripts this lane meets — so the
 * script census below is its own.
 *
 * Verdict on one re-read of a page whose stored OCR looped (#3878).
 *
 * A re-read is ACCEPTED only when none of these fire:
 *   loop             the write gate's own verdict (exact periodic run ≥ 50% of the body)
 *   near-loop        O4 `repeatedBlocks` calls the page a loop (one phrase over and over,
 *                    or ≥ 10 copies of a block) covering ≥ 50% of it. Measured on the pilot:
 *                    the court-hand near-loop scored 0.83 and flash's 58K invention 0.98; the
 *                    Daihannya sutra formula (genuine) 0.20 and the Avestan Vendidad formulas
 *                    0.11 — both pass.
 *   declined         the model wrote (almost) nothing, or mostly `<unclear>`
 *   max-tokens       the response hit the output cap — a runaway even if it is not periodic
 *   runaway          body over HALLUCINATION_LIMIT (the collector's own length guard)
 *   script-mismatch  the body's dominant script is not one the book's language is written in
 *                    (pilot: a Bugis poem returned in Javanese script). Unknown language → no
 *                    verdict; Latin is always allowed (apparatus, transliteration).
 *
 * Measured on #3878's pilot (30 looping pages, 3 arms): see
 * scripts/eval/experiments/2026-10-01-can-a-re-read-fix-looping-ocr-pages-3878.md.
 */
import { loopVerdict } from './ocr-loop-guard.mjs';
import { repeatedBlocks } from './page-integrity.mjs';
import { transcriptionBody } from './blank-page-guard.mjs';

/** Same ceiling the batch collector drops responses at. */
export const HALLUCINATION_LIMIT = 25000;
export const NEAR_LOOP_MIN_SHARE = 0.5;
export const MIN_READ_CHARS = 80;
export const MAX_UNCLEAR_SHARE = 0.5;

const SCRIPT_NAMES = [
  'Latin', 'Greek', 'Coptic', 'Cyrillic', 'Armenian', 'Georgian', 'Hebrew', 'Arabic', 'Syriac',
  'Ethiopic', 'Devanagari', 'Bengali', 'Gujarati', 'Tibetan', 'Myanmar', 'Thai', 'Khmer',
  'Javanese', 'Balinese', 'Buginese', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Tangut',
  'Egyptian_Hieroglyphs', 'Avestan', 'Mongolian',
];
const SCRIPT_RES = SCRIPT_NAMES.map(n => [n, new RegExp(`\\p{Script=${n}}`, 'u')]);

/**
 * Scripts a book in this language may legitimately come back in, keyed by the first word of
 * `books.language`, lower-cased ("Japanese Japanese" → japanese). A language not listed gets
 * no script verdict: refusing on a guess would withhold real readings.
 */
export const LANGUAGE_SCRIPTS = {
  latin: ['Latin'], french: ['Latin'], law: ['Latin'], german: ['Latin'], english: ['Latin'],
  italian: ['Latin'], spanish: ['Latin'], dutch: ['Latin'],
  greek: ['Greek'], hebrew: ['Hebrew'], yiddish: ['Hebrew'], ladino: ['Hebrew'],
  arabic: ['Arabic'], persian: ['Arabic'], ottoman: ['Arabic'], syriac: ['Syriac'],
  armenian: ['Armenian'], georgian: ['Georgian'], russian: ['Cyrillic'], coptic: ['Coptic', 'Greek'],
  "ge'ez": ['Ethiopic'], amharic: ['Ethiopic'],
  chinese: ['Han'], japanese: ['Han', 'Hiragana', 'Katakana'], korean: ['Hangul', 'Han'],
  vietnamese: ['Han'], tangut: ['Tangut', 'Han'], tibetan: ['Tibetan'], burmese: ['Myanmar'],
  thai: ['Thai'], khmer: ['Khmer'], mongolian: ['Mongolian', 'Han'],
  javanese: ['Javanese', 'Arabic'], balinese: ['Balinese'], bugis: ['Buginese', 'Arabic'],
  malay: ['Arabic'], egyptian: ['Egyptian_Hieroglyphs'], avestan: ['Avestan', 'Gujarati', 'Arabic'],
};

/** The script most of the body's letters belong to, or null (first 3,000 code points). */
export function bodyScript(body) {
  const counts = new Map();
  for (const ch of [...String(body || '')].slice(0, 3000)) {
    for (const [name, re] of SCRIPT_RES) if (re.test(ch)) { counts.set(name, (counts.get(name) || 0) + 1); break; }
  }
  let best = null, n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

export function allowedScripts(language) {
  const key = String(language || '').trim().split(/\s+/)[0]?.toLowerCase();
  const list = LANGUAGE_SCRIPTS[key];
  return list ? ['Latin', ...list] : null;
}

/**
 * @param {string} text           the model's response (OCR markup and all)
 * @param {object} opts
 * @param {string} [opts.language]     books.language
 * @param {string} [opts.finishReason] the candidate's finishReason
 * @returns {{ accept: boolean, reasons: string[], body: number, script: string|null, nearLoopShare: number }}
 */
export function rereadVerdict(text, { language = null, finishReason = null } = {}) {
  const t = String(text || '');
  const body = transcriptionBody(t);
  const reasons = [];

  if (loopVerdict(t).refuse) reasons.push('loop');
  const o4 = repeatedBlocks(t);
  const nearLoopShare = o4.judged && o4.kind === 'loop' ? o4.share : 0;
  if (nearLoopShare >= NEAR_LOOP_MIN_SHARE) reasons.push('near-loop');

  const unclear = [...t.matchAll(/<unclear[^>]*>([\s\S]*?)<\/unclear>/gi)].reduce((s, m) => s + m[1].length, 0);
  if (body.length < MIN_READ_CHARS || (body.length && unclear / body.length >= MAX_UNCLEAR_SHARE)) reasons.push('declined');
  if (finishReason === 'MAX_TOKENS') reasons.push('max-tokens');
  if (body.length > HALLUCINATION_LIMIT) reasons.push('runaway');

  const script = bodyScript(body);
  const allowed = allowedScripts(language);
  if (allowed && script && !allowed.includes(script)) reasons.push('script-mismatch');

  return { accept: reasons.length === 0, reasons, body: body.length, script, nearLoopShare };
}

/** Does the STORED OCR loop? The same two repetition tests a re-read must pass. */
export function storedLoops(text) {
  if (loopVerdict(text).refuse) return 'loop';
  const o4 = repeatedBlocks(String(text || ''));
  return o4.judged && o4.kind === 'loop' && o4.share >= NEAR_LOOP_MIN_SHARE ? 'near-loop' : null;
}

/** Reasons that mean "Gemini cannot read this page" — both passes failing on these marks it unreadable. */
export const UNREADABLE_REASONS = new Set(['loop', 'near-loop', 'declined', 'max-tokens', 'runaway']);

/**
 * SERVE / MARK / REVIEW / PENDING for one page, from its pass results `{ 1: verdict, 2: verdict }`.
 * A pass that failed ONLY on script-mismatch sends the page to REVIEW, never to MARK: the
 * catalogue language may be the wrong one, and withholding on a guess hides real text.
 *
 * `stored` is why the page was selected. A page selected only as a NEAR-loop is never marked:
 * a formulaic enumeration (a scholastic chain "Et de uirtute X est quod lapis habet uirtutem
 * que est uirtus Y…", seen in the first plan) can be genuine, and a faithful re-read of it
 * trips the same test again. Exact loops have no such reading.
 */
export function decide(res, stored = 'loop') {
  const p1 = res?.[1], p2 = res?.[2];
  if (p1?.accept) return { action: 'SERVE', pass: 1 };
  if (p2?.accept) return { action: 'SERVE', pass: 2 };
  if (!p1 || !p2) return { action: 'PENDING' };
  const reasons = [...p1.reasons, ...p2.reasons];
  if (reasons.some(r => r === 'image-fetch-failed' || r.startsWith('job-'))) return { action: 'PENDING' };
  if ([p1, p2].some(p => p.reasons.length === 1 && p.reasons[0] === 'script-mismatch')) return { action: 'REVIEW' };
  if (stored === 'near-loop') return { action: 'REVIEW' };
  if (reasons.some(r => UNREADABLE_REASONS.has(r))) return { action: 'MARK', reasons: [...new Set(reasons)] };
  return { action: 'REVIEW' };
}
