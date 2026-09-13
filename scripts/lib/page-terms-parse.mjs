// PRIOR ART: scripts/lib/ngram-normalize.mjs (strips apparatus tags, never reads them);
// src/lib/build-book-index.ts (reads <term> per book for the index, not per page, no vocab/keywords);
// src/lib/normalize-annotation-spans.ts (repairs span shape, extracts nothing). None yields
// a (page, term, gloss, language) row, which is what #4695 needs.
/**
 * Parse the per-page vocabulary the OCR and translation prompts already emit (#4695):
 *
 *   ocr.data          <vocab>三昧 (Samadhi), 法華經 (Lotus Sutra)</vocab>         kind: "vocab"
 *   translation.data  <term>terma</term> <gloss>treasure</gloss>                 kind: "term"
 *   translation.data  <keywords>silence, hesychia, Spirit</keywords>             kind: "keyword"
 *   translation.data  stillness <note>original: "ἡσυχίαν" (hesychian). …</note> kind: "original"
 *
 * Pure functions, no I/O, so they can be unit-tested per script. Nothing here decides
 * what a term MEANS — it records what the model wrote, where, and (for original-notes)
 * whether the quoted string is really on the OCR page (12.2% are not, #3308).
 *
 * Normalisation follows .claude/docs/invariants/non-latin-text-operations.md: NFC for
 * every script, lowercase + diacritic folding ONLY when the string is Latin-script.
 * Folding "ἡσυχία" or "三昧" would be destructive, and lowercasing is meaningless there.
 */

import { skeletonMatch } from './translit-skeleton.mjs';

const MAX_TERM = 80;
const MAX_GLOSS = 160;
/** Characters of translated text kept BEFORE a <term>/<note original> as `context` — the
 *  translator's own rendering sits there ("stillness <note>original: "ἡσυχίαν"…"), and an
 *  LLM judge deciding cross-tradition equivalence needs it. Trailing text is not kept. */
export const CONTEXT_CHARS = 120;

/** True when the string contains at least one Latin letter and no letter from another script. */
export function isLatinScript(s) {
  if (!s) return false;
  const hasLatin = /\p{Script=Latin}/u.test(s);
  const hasOther = /[\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Tibetan}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Thai}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Syriac}\p{Script=Ethiopic}]/u.test(s);
  return hasLatin && !hasOther;
}

/** Comparison key. Latin script: NFC → lowercase → strip combining marks. Other scripts: NFC only. */
export function termKey(s) {
  const nfc = String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!isLatinScript(nfc)) return nfc;
  return nfc.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
}

/**
 * Early-modern and manuscript orthography that is the SAME LETTER as its modern form for the
 * purpose of "is this phrase on the page". Latin-script only — every key here is a Latin
 * codepoint, so applying the map to a mixed page cannot touch Greek, Hebrew or Han text.
 * The long s is the expensive one: early-modern printing uses it throughout, so before this
 * map a quotation containing any "s" could not match its own page.
 */
const HISTORIC_FORMS = new Map(Object.entries({
  'ſ': 's', 'ﬅ': 'st', 'ﬆ': 'st', 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl',
  'ﬃ': 'ffi', 'ﬄ': 'ffl', 'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'Œ': 'oe',
  'ß': 'ss', 'ʒ': 'z', 'ȝ': 'g', 'ı': 'i', '’': "'", '‘': "'",
}));

/**
 * Fold a string for QUOTE COMPARISON only. Never use this as a storage or display key.
 *
 * Per non-latin-text-operations.md this must not destroy non-Latin text, and a page is
 * routinely mixed (a Latin commentary around a Greek lemma). So it works per character:
 * a combining mark is stripped only when the base letter it sits on is Latin, and the
 * historic-form map only contains Latin codepoints. Greek breathings, Hebrew points and
 * Arabic diacritics therefore survive untouched.
 */
export function foldForQuoteMatch(s) {
  const nfd = String(s || '').normalize('NFD');
  let out = '';
  let baseIsLatin = false;
  for (const ch of nfd) {
    if (/\p{M}/u.test(ch)) { if (!baseIsLatin) out += ch; continue; }  // drop marks on Latin only
    const latin = /\p{Script=Latin}/u.test(ch);
    baseIsLatin = latin;
    out += latin ? (HISTORIC_FORMS.get(ch) ?? ch.toLowerCase()) : ch;
  }
  return out.normalize('NFC').replace(/[\s\p{P}]+/gu, ' ').trim();
}

/** True when `s` contains a letter from a non-Latin script. */
export function hasNonLatinLetter(s) {
  return /[\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Tibetan}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Thai}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Syriac}\p{Script=Ethiopic}]/u.test(String(s || ''));
}

/**
 * Is the quoted phrase of an <note>original: "…"</note> really on this page? (#4777)
 *
 * Returns a TIER, not a boolean, because the old boolean conflated four different things and
 * three of them were the instrument's fault. Measured on a 500-note random sample, the old
 * "unverified" bucket was 50% romanisation, 20% diacritics, 6% historic orthography, 4%
 * inflection — and only 20% genuinely absent.
 *
 *   'exact'   the phrase is on the page, character for character
 *   'folded'  on the page once Latin diacritics and historic letter-forms are folded
 *   'stem'    the leading 80% of the phrase is on the page (the note gave another inflection)
 *   'translit' a Latin-script quote whose consonant skeleton is on the page once the page's
 *             Greek / Devanagari / Tibetan / Arabic / Hebrew / Syriac / Cyrillic is romanised
 *             the same way (translit-skeleton.mjs) — the note romanises what the page prints
 *   'script'  CANNOT BE CHECKED: a Latin-script quote against a page in a script we cannot
 *             romanise (Han, Kana, …). Not evidence of fabrication, and must never be counted
 *             as such.
 *   'absent'  not on the page by any of the above. The honest suspect class.
 *
 * `absent` still includes benign cases seen in hand review — a note citing ANOTHER work, or
 * quoting the Greek behind a Coptic text — so it is an upper bound on fabrication, not a count
 * of it.
 */
const TIER_RANK = { exact: 0, folded: 1, stem: 2, translit: 3, script: 4, absent: 5 };

export function verifyQuote(quote, ocrText) {
  const q = String(quote || '').trim();
  const ocr = String(ocrText || '');
  if (!q || !ocr) return 'absent';

  // An elided quote — `imberbem... Cometam` — is two fragments the translator saw on the page
  // with something between them. Verify each fragment; the verdict is the WEAKEST fragment's.
  // Without this the ellipsis itself guaranteed an 'absent'.
  const parts = q.split(/\s*(?:\.{3,}|…)\s*/).map(p => p.trim()).filter(p => p.length >= 4);
  if (parts.length > 1) {
    return parts.map(p => verifyQuote(p, ocrText)).reduce((a, b) => (TIER_RANK[a] >= TIER_RANK[b] ? a : b));
  }

  const ocrNfc = ocr.normalize('NFC').replace(/\s+/g, ' ');
  if (ocrNfc.includes(q.normalize('NFC'))) return 'exact';

  const fq = foldForQuoteMatch(q);
  // Printed text breaks words at line ends with a hyphen ("infal-\nlibilem"); by the time the
  // page reaches here its whitespace is collapsed, so the break reads "infal- libilem". Join a
  // letter–hyphen–space–lowercase-letter sequence before comparing: a quote of the whole word
  // could otherwise never match its own page.
  const fo = foldForQuoteMatch(ocrNfc.replace(/(\p{L})[-‐‑]\s+(\p{Ll})/gu, '$1$2'));
  if (fq && fo.includes(fq)) return 'folded';

  // Inflection: the note gives a lemma or a different case ending. Require a real stem so a
  // two-letter prefix can never "verify" a phrase.
  if (fq.length >= 6) {
    const stem = fq.slice(0, Math.max(5, Math.floor(fq.length * 0.8)));
    if (stem.length >= 5 && fo.includes(stem)) return 'stem';
  }

  // A Latin-script quote against a page that prints another script is a romanisation. Reduce
  // both to a per-script consonant skeleton (translit-skeleton.mjs) and compare: a hit is
  // 'translit'. A miss on a page whose every non-Latin script we can romanise is 'absent' —
  // measured 2026-09-13, a quarter of the Greek- and Devanagari-page cases were an ENGLISH
  // word noted as "original" on a Latin-script page with one stray foreign letter. A miss on
  // a page carrying a script we cannot romanise (Han, Kana, …) stays 'script': uncheckable,
  // and never to be counted as fabrication.
  if (isLatinScript(q) && hasNonLatinLetter(ocrNfc)) {
    const m = skeletonMatch(q, ocrNfc);
    if (m.matched) return 'translit';
    return m.uncovered ? 'script' : 'absent';
  }

  return 'absent';
}

/** Back-compatible boolean: true when the phrase was located, false when absent, null when
 *  it cannot be checked by substring at all ('script'). Callers that counted `verified === false`
 *  as fabrication get null instead of a false accusation. */
export function quoteVerified(tier) {
  if (tier === 'script') return null;
  return tier === 'exact' || tier === 'folded' || tier === 'stem' || tier === 'translit';
}

function clean(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’«»,;:.]+|[\s"'“”‘’«»,;:.]+$/g, '')
    .trim();
}

/** The plain text (tags stripped, whitespace collapsed) immediately before index `idx`. */
function contextBefore(text, idx) {
  const raw = text.slice(Math.max(0, idx - CONTEXT_CHARS * 2), idx);
  const plain = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > CONTEXT_CHARS ? plain.slice(-CONTEXT_CHARS) : plain || null;
}

function tooLong(term, gloss) {
  return term.length > MAX_TERM || (gloss && gloss.length > MAX_GLOSS);
}

/**
 * Split a comma-list the way the models write them: ASCII/CJK commas, ideographic
 * enumeration comma (、), semicolons; but NOT commas inside parentheses.
 */
export function splitList(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '（') depth++;
    else if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || ch === '，' || ch === '、' || ch === ';' || ch === '；' || ch === '\n')) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** "三昧 (Samadhi)" → { term: "三昧", gloss: "Samadhi" }; "λόγος" → { term: "λόγος", gloss: null }. */
export function splitTermGloss(item) {
  const m = item.match(/^(.*?)\s*[(（]([^()（）]{1,160})[)）]\s*$/);
  if (m && m[1].trim()) return { term: clean(m[1]), gloss: clean(m[2]) || null };
  return { term: clean(item), gloss: null };
}

/** All <tag>…</tag> bodies, non-nested, lazy. */
function bodies(text, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

/**
 * Parse the OCR side. Returns rows without book/page (caller adds them).
 * @param {string} ocrText
 */
export function parseOcrVocab(ocrText) {
  const rows = [];
  for (const body of bodies(ocrText || '', 'vocab')) {
    for (const item of splitList(body)) {
      const { term, gloss } = splitTermGloss(item);
      if (!term || tooLong(term, gloss)) continue;
      rows.push({ kind: 'vocab', term, gloss });
    }
  }
  return dedupe(rows);
}

/**
 * Parse the translation side: <term>/<gloss> pairs, <keywords> lists, and
 * <note>original: "…"</note> with verification against the OCR text.
 * @param {string} translationText — the page, OR the concatenated server-side
 *   `$regexFindAll` matches (build-page-terms.mjs sends leading context + tag per match).
 * @param {string|null} [ocrText] for verifying original-notes; omit → verified: null
 * @param {{verified?: Map<string, boolean>}} [opts] — pre-computed verification keyed by the
 *   quoted original string (server-side `$indexOfCP`), used when ocrText is not fetched.
 */
export function parseTranslationTerms(translationText, ocrText, opts = {}) {
  const t = translationText || '';
  const rows = [];

  // <term>X</term> optionally followed (whitespace only) by <gloss>Y</gloss>
  const termRe = /<term(?:\s[^>]*)?>([\s\S]*?)<\/term>(\s*<gloss(?:\s[^>]*)?>([\s\S]*?)<\/gloss>)?/gi;
  let m;
  while ((m = termRe.exec(t))) {
    const term = clean(m[1]);
    const gloss = m[3] ? clean(m[3]) : null;
    if (!term || tooLong(term, gloss)) continue;
    rows.push({ kind: 'term', term, gloss, context: contextBefore(t, m.index) });
  }

  for (const body of bodies(t, 'keywords')) {
    for (const item of splitList(body)) {
      const { term, gloss } = splitTermGloss(item);
      if (!term || tooLong(term, gloss)) continue;
      rows.push({ kind: 'keyword', term, gloss });
    }
  }

  // <note>original: "ἡσυχίαν" (hesychian). A technical term…</note>
  // The quoted string is the ORIGINAL-language term; the preceding word(s) in the
  // translation are the translator's rendering. We keep the quoted original as `term`
  // and the parenthetical transliteration, if any, as `gloss`.
  const ocrNorm = ocrText ? String(ocrText).normalize('NFC').replace(/\s+/g, ' ') : null;
  const noteRe = /<note(?:\s[^>]*)?>\s*original:\s*["“«']([^"”»']{1,80})["”»']\s*(?:[(（]([^()（）]{1,80})[)）])?/gi;
  while ((m = noteRe.exec(t))) {
    const term = clean(m[1]);
    const gloss = m[2] ? clean(m[2]) : null;
    if (!term || tooLong(term, gloss)) continue;
    // #4777: a TIER, not a boolean. The old plain substring counted romanisation, historic
    // orthography and inflection as fabrication — 80% of the "unverified" population.
    let match = null;
    let verified = null;
    if (ocrNorm !== null) {
      match = verifyQuote(term, ocrNorm);
      verified = quoteVerified(match);
    } else if (opts.verified) {
      // Server-side pre-verification (build-page-terms.mjs) hands back a map. It may carry a
      // tier string or, from an older run, a bare boolean.
      const pre = opts.verified.has(m[1]) ? opts.verified.get(m[1]) : null;
      if (typeof pre === 'string') { match = pre; verified = quoteVerified(pre); }
      else { verified = pre; match = pre === true ? 'exact' : pre === false ? 'absent' : null; }
    }
    rows.push({ kind: 'original', term, gloss, verified, match, context: contextBefore(t, m.index) });
  }

  return dedupe(rows);
}

/** One row per (kind, termKey) within a page; first occurrence wins, but a later gloss fills a missing one. */
export function dedupe(rows) {
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.kind} ${termKey(r.term)}`;
    const prev = seen.get(k);
    if (!prev) seen.set(k, { ...r, term_key: termKey(r.term) });
    else if (!prev.gloss && r.gloss) prev.gloss = r.gloss;
  }
  return [...seen.values()];
}
