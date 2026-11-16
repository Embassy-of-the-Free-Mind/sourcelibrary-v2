/**
 * PRIOR ART: scripts/lib/correction-diff-guard.mjs — NEGATIONS (la/en/de/fr/it) and the negation/number side of a diff
 * between two reads in ONE language; reused here for the lexicons, but this file compares a source with its English,
 * where no token alignment exists. scripts/audit/ocr-negation-flip-candidates.mjs — two OCR reads, not OCR vs English.
 * scripts/lib/glm-digit-repair.mjs — digits between two OCR reads. scripts/lib/illegible-source-gate.mjs — refuses a
 * page with no legible body; its contract (c), "the translator reproduces <unclear> spans", is what englishOverUnclear
 * measures and nothing else checks. scripts/lib/page-integrity.mjs — page-level integrity, no source↔English checks.
 *
 * ocr-english-checks.mjs — free, deterministic checks on a page's OCR and its English together (#8632 Part 4).
 *
 * The English alone cannot tell a reader that a negation was lost, a number added or a passage dropped: the prose is
 * fluent. The PAIR sometimes can. Each check returns a number (higher = more suspicious) and a short reason, never a
 * verdict. scripts/eval/error-zoo/detector-suite.mjs measures each against the error zoo's specimens and the audit's
 * clean random pages before any of them is used for anything.
 *
 *   negationDeficit(ocr, en, lang)   T8: source negations not matched by English negations
 *   untracedNumbers(ocr, en)         O7/T10: numbers in the English with no numeral of that value in the source
 *   englishOverUnclear(ocr, en)      T7: <unclear> spans in the OCR, and no uncertainty marker in the English
 *   sentenceShortfall(ocr, en)       T9: English sentences per source sentence (the caller compares with a norm)
 *   noteHedges(en)                   T10: hedging words inside <note>/<gloss>
 */
import { NEGATIONS } from './correction-diff-guard.mjs';

// Source-side negation lexicons beyond correction-diff-guard's five. Greek: the οὐ/μή families (accents folded).
// Chinese: single characters that negate in classical and modern usage. Counted as characters, so 無量 counts
// (measured noise: the suite reports it, nothing refuses on it).
const NEG_EXTRA = {
  el: ['ου', 'ουκ', 'ουχ', 'μη', 'ουδε', 'μηδε', 'ουτε', 'μητε', 'ουδεις', 'ουδεν', 'ουδενα', 'ουδενος', 'μηδεις', 'μηδεν', 'ουδαμως', 'μηδαμως', 'ουποτε', 'μηποτε', 'ουπω', 'μηπω', 'ουκετι', 'μηκετι', 'ουδαμου', 'ουχι'],
  nl: ['niet', 'geen', 'nooit', 'niets', 'niemand', 'noch', 'nergens'],
  es: ['no', 'ni', 'nunca', 'jamas', 'nada', 'nadie', 'ninguno', 'ninguna', 'tampoco'],
};
const CJK_NEG = /[不無无非未莫勿毋弗否没沒罔靡]/gu;
const EN_NEG_EXTRA = ['without', 'nobody', 'nowise', 'nay', 'none', 'neither'];

export const langKey = (s) => {
  const t = String(s || '').toLowerCase();
  if (/^(la|lat)/.test(t)) return 'la';
  if (/^(grc|el|greek|gre|ell)/.test(t)) return 'el';
  if (/^(de|ger|deu)/.test(t)) return 'de';
  if (/^(fr|fre|fra)/.test(t)) return 'fr';
  if (/^(it|ita)/.test(t)) return 'it';
  if (/^(nl|dut|nld|dutch)/.test(t)) return 'nl';
  if (/^(es|spa|spanish)/.test(t)) return 'es';
  if (/^(zh|chi|zho|chinese|ja|jpn|japanese|ko|kor|korean)/.test(t)) return 'cjk';
  if (/^(en|eng)/.test(t)) return 'en';
  return null;
};

const fold = (w) => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ſ/g, 's').replace(/ς/g, 'σ').replace(/v/g, 'u').replace(/j/g, 'i');
const foldEl = (w) => fold(w).replace(/σ/g, 'σ');

/** Tags whose contents describe the page rather than transcribe or translate it. Notes and glosses are KEPT: they
 * are English a reader reads, and T10 lives in them. */
const META = ['scan-quality', 'language', 'script', 'page-type', 'page-num', 'columns', 'meta', 'vocab', 'warning',
  'image-desc', 'detected-images', 'split-position', 'header', 'sig', 'catchword', 'summary', 'quality'];
const META_RE = new RegExp(`<(${META.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?</\\1>`, 'gi');

/** The body: metadata blocks removed, other tags dropped but their contents kept. */
export function body(text, { keepUnclearTags = false } = {}) {
  let s = String(text || '').replace(META_RE, ' ');
  if (keepUnclearTags) s = s.replace(/<(?!\/?unclear\b)[^<>\n]{0,200}>/gi, ' ');
  else s = s.replace(/<[^<>\n]{0,200}>/g, ' ');
  return s.replace(/[ \t]+/g, ' ').trim();
}

const words = (s) => (String(s).match(/[\p{L}\p{M}'’]+/gu) || []).map((w) => w.replace(/^['’]+|['’]+$/g, ''));

/** Negation count in a source text of language `lang` (a langKey), and in English. */
export function negationCount(text, lang) {
  const b = body(text);
  if (lang === 'cjk') return (b.match(CJK_NEG) || []).length;
  const lex = new Set([...(NEGATIONS[lang] || []), ...(NEG_EXTRA[lang] || []), ...(lang === 'en' ? EN_NEG_EXTRA : [])].map(fold));
  if (!lex.size) return null;
  let n = 0;
  for (const w of words(b)) {
    const f = lang === 'el' ? foldEl(w) : fold(w);
    if (lex.has(f)) n++;
    else if (lang === 'en' && /n['’]t$/.test(f)) n++;
  }
  // French ne…pas: count the pair once
  if (lang === 'fr') n = Math.ceil(n / 2);
  return n;
}

/** T8. Score = source negations − English negations (≥ 0), or null when the language has no lexicon. */
export function negationDeficit(ocr, en, lang) {
  const src = negationCount(ocr, lang), eng = negationCount(en, 'en');
  if (src == null) return { score: null, src, eng };
  return { score: Math.max(0, src - eng), src, eng };
}

// ── numbers ────────────────────────────────────────────────────────────────────────────────────

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
function roman(tok) {
  const t = tok.toLowerCase().replace(/j$/, 'i');
  if (!/^[ivxlcdm]+$/.test(t) || t.length > 9) return null;
  let v = 0;
  for (let i = 0; i < t.length; i++) {
    const a = ROMAN[t[i]], b = ROMAN[t[i + 1]] || 0;
    v += a < b ? -a : a;
  }
  return v > 0 ? v : null;
}
const GREEK_NUM = { α: 1, β: 2, γ: 3, δ: 4, ε: 5, ϛ: 6, ϝ: 6, ζ: 7, η: 8, θ: 9, ι: 10, κ: 20, λ: 30, μ: 40, ν: 50, ξ: 60, ο: 70, π: 80, ϟ: 90, ϙ: 90, ρ: 100, σ: 200, τ: 300, υ: 400, φ: 500, χ: 600, ψ: 700, ω: 800, ϡ: 900 };
function greekNumeral(tok) {
  let v = 0;
  for (const ch of fold(tok).replace(/σ$/, 'σ')) { const x = GREEK_NUM[ch]; if (!x) return null; v += x; }
  return v || null;
}
const CJK_DIG = { 〇: 0, 零: 0, 一: 1, 壹: 1, 二: 2, 貳: 2, 兩: 2, 两: 2, 三: 3, 參: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陸: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9 };
const CJK_UNIT = { 十: 10, 拾: 10, 廿: 20, 卅: 30, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 萬: 10000, 万: 10000, 億: 1e8, 亿: 1e8 };
function cjkValues(run) {
  // a run of numeral characters → its value, and each digit-by-digit reading (年號 years are often written 一七六五)
  const out = new Set();
  let total = 0, section = 0, num = 0, plain = '';
  for (const ch of run) {
    if (ch in CJK_DIG) { num = CJK_DIG[ch]; plain += num; }
    else {
      const u = CJK_UNIT[ch];
      if (u >= 10000) { section = (section + num) * u; total += section; section = 0; }
      else section += (num || 1) * u;
      num = 0;
    }
  }
  out.add(total + section + num);
  if (plain.length > 1) out.add(Number(plain));
  return out;
}

/** Every numeric value the source text can be read as carrying. */
export function sourceNumbers(text) {
  const b = body(text);
  const vals = new Set();
  for (const m of b.matchAll(/\d+(?:[.,]\d+)?/g)) { vals.add(Number(m[0].replace(',', '.'))); vals.add(Number(m[0].replace(/[.,]/g, ''))); }
  for (const m of b.matchAll(/[〇零一壹二貳兩两三參四肆五伍六陸七柒八捌九玖十拾廿卅百佰千仟萬万億亿]+/gu)) for (const v of cjkValues(m[0])) vals.add(v);
  for (const w of words(b)) {
    const r = roman(w); if (r != null) vals.add(r);
  }
  // dotted or spaced Roman dates: M.D.LXXXIII, M. DC. LI, cIↄ Iↄ c. → one value (round 1 on half A: 1583 read as M.D.LXXXIII)
  for (const m of b.replace(/[cC]I[ↄ)]/g, 'M').replace(/I[ↄ)]/g, 'D').matchAll(/\b[MDCLXVI]+(?:[.\s]{1,2}[MDCLXVI]+){1,5}\b\.?/gi)) {
    const r = roman(m[0].replace(/[.\s]/g, '')); if (r != null) vals.add(r);
  }
  // Hebrew letter numerals marked with geresh/gershayim (י"ב, ה׳)
  const HEB = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
  for (const m of b.matchAll(/([א-ת]{1,4})["'״׳]([א-ת])?/g)) {
    let v = 0; for (const ch of (m[1] + (m[2] || ''))) v += HEB[ch] || 0; if (v) vals.add(v);
  }
  // Greek alphabetic numerals carry a keraia (ʹ ' ′ ΄) after them
  for (const m of b.matchAll(/([\p{Script=Greek}]{1,4})[ʹ'′΄]/gu)) { const g = greekNumeral(m[1]); if (g) vals.add(g); }
  return vals;
}

/**
 * O7/T10. English digit numbers whose value the source does not carry, split into the running English (`score`) and
 * the translator's own notes and glosses (`inNotes`). Excused: a chapter:verse reference inside a note (round 1 on
 * half A: "Genesis 9:27" on a Targum page), which is apparatus the translator added and the audit judged clean.
 */
export function untracedNumbers(ocr, en) {
  const src = sourceNumbers(ocr);
  const s = String(en || '');
  const noteSpans = [...s.matchAll(/<(note|gloss)\b[^>]*>[\s\S]*?<\/\1>/gi)].map((m) => [m.index, m.index + m[0].length]);
  const inNote = (i) => noteSpans.some(([a, b]) => i >= a && i < b);
  const metaMask = new Uint8Array(s.length);
  for (const m of s.matchAll(META_RE)) metaMask.fill(1, m.index, m.index + m[0].length);
  const miss = [], missNote = [];
  let n = 0;
  for (const m of s.matchAll(/\d+(?:[.,]\d+)?(?::\d+)?/g)) {
    if (metaMask[m.index]) continue;
    // a digit inside a tag's attributes is not text
    const lt = s.lastIndexOf('<', m.index), gt = s.lastIndexOf('>', m.index);
    if (lt > gt) continue;
    n++;
    const note = inNote(m.index);
    if (note && m[0].includes(':')) continue;
    const parts = m[0].split(':');
    const ok = parts.every((x) => { const v = Number(x.replace(',', '.')), w = Number(x.replace(/[.,]/g, '')); return src.has(v) || src.has(w); });
    if (ok) continue;
    (note ? missNote : miss).push(m[0]);
  }
  return { score: miss.length, inNotes: missNote.length, numbers: n, untraced: miss.slice(0, 10), untracedInNotes: missNote.slice(0, 10) };
}

// ── uncertainty ────────────────────────────────────────────────────────────────────────────────

const EN_UNCERTAIN = /<unclear\b|\[(?:illegible|unclear|lacuna|gap|\?|…|\.\.\.)[^\]]*\]|\[\s*\.{2,}\s*\]|\(\?\)|\[\?\]|illegible|unclear/gi;

/** T7. OCR <unclear> spans (and lacuna marks), against uncertainty markers in the English. */
export function englishOverUnclear(ocr, en) {
  const s = String(ocr || '');
  const unclear = (s.match(/<unclear\b/gi) || []).length + (s.match(/\[\s*(?:\.{2,}|…)\s*\]/g) || []).length;
  const marks = (String(en || '').match(EN_UNCERTAIN) || []).length;
  return { score: unclear > 0 ? Math.max(0, unclear - marks) : 0, unclear, marks };
}

// ── completeness ───────────────────────────────────────────────────────────────────────────────

const SENT_END = /[.!?;。！？·]+(?=\s|$)|[。！？]/gu;
export function sentenceCount(text) {
  const b = body(text).replace(/\b(?:[A-Za-z]|cap|lib|fol|cf|vol|ch|p|pp|etc|viz|sc|i\.e|e\.g)\./gi, '');
  return (b.match(SENT_END) || []).length;
}

/** T9. English sentences and characters per source unit; the caller compares with the book or language norm. */
export function sentenceShortfall(ocr, en) {
  const so = sentenceCount(ocr), se = sentenceCount(en);
  const lo = body(ocr).length, le = body(en).length;
  return { srcSentences: so, enSentences: se, ratio: so >= 4 ? se / so : null, lenRatio: lo >= 200 ? le / lo : null };
}

// ── notes ──────────────────────────────────────────────────────────────────────────────────────

const HEDGE = /\b(likely|possibly|probably|perhaps|presumably|apparently|seems?|appears?|may (?:be|refer|mean|indicate)|might|could (?:be|refer)|unclear|uncertain|conjectur\w*)\b/gi;

/** T10. Hedging words inside the English's notes and glosses. */
export function noteHedges(en) {
  const s = String(en || '');
  let notes = 0, hedges = 0;
  for (const m of s.matchAll(/<(note|gloss)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    notes++;
    hedges += (m[2].match(HEDGE) || []).length;
  }
  return { score: hedges, notes, hedges };
}
