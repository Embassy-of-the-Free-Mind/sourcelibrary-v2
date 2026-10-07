// PRIOR ART: scripts/lib/translate-core.mjs `hasTranslatableSource` / `isTranslatablePage` — the
// pre-flight door this plugs into. It refuses a page with NO body, but lets any page with a
// ≥ 24-char <image-desc> through, so an illegible papyrus with "[...]" and a described library
// stamp (Herculanensium 1871 p.328, #5274) is still sent to the model, which writes theology.
// scripts/lib/ocr-garble-score.mjs `ocrSelfCaution` — the reader-note copy of what the OCR
// admitted; it fires on ANY read harm ("several lines difficult to decipher"), which is a caution,
// not a reason to refuse a page. scripts/lib/ocr-garble-verdict.mjs — the $0 text garble verdict;
// it needs a corpus lexicon that lives on one laptop, so it is accepted here as an injected
// verdict, never computed. scripts/lib/ocr-loop-guard.mjs — the loop refusal, already its own gate.
/**
 * illegible-source-gate — the translation OUTPUT CONTRACT for a page nobody could read (#5305).
 *
 * The contract (spec: scripts/eval/PREREGISTRATION-illegible-gate.md):
 *
 *   (a) the OCR has no legible body — nothing left once lacuna markers and <unclear> spans are
 *       removed — or its own <warning> says the page is (almost) entirely illegible
 *         → the translation is exactly `<warning>Illegible: <reason></warning>`, with no
 *           <summary>, and the English is withheld through the #4883 path;
 *   (b) a garble verdict over threshold → the same as (a);
 *   (c) partial garble → the OCR wraps the unread spans in <unclear>, and the translator
 *       reproduces them unchanged (prompt-side; already in translation prompt v13).
 *
 * (a) and (b) are decided HERE, from the OCR text alone, BEFORE any model call: it costs nothing
 * and does not depend on the model obeying a prompt it has already been shown to ignore.
 *
 * OFF BY DEFAULT. Nothing reads this verdict unless `TRANSLATE_ILLEGIBLE_GATE=1` is set in the
 * process environment (or a caller passes `illegibleGate: true`). Turning it on is Derek's call.
 *
 * WHAT THIS CANNOT SEE. Fluent misreadings. Most garble the #5274 judge flagged is real-looking
 * text in the right script that is not what the page says; the OCR reports it as `good` and marks
 * nothing. No text-only feature separates it (lexicon OOV AUC 0.61–0.74, char-trigram AUC 0.52;
 * scripts/eval/experiments/2026-10-02-illegible-gate-5305.md). That class needs a second read
 * or the image, not this gate.
 */

/** Environment flag. Anything but the literal string '1' is off. */
export const ILLEGIBLE_GATE_ENV = 'TRANSLATE_ILLEGIBLE_GATE';
export const illegibleGateEnabled = (env = process.env) => env?.[ILLEGIBLE_GATE_ENV] === '1';

/** Reason stamped on `translation.health_blocked`, and on `translation_withheld.reason`. */
export const ILLEGIBLE_SOURCE_REASON = 'illegible_source';

/** Legible letters and digits below which a page has nothing a translator could have read. */
export const MIN_LEGIBLE_LETTERS = 20;

/**
 * Pages whose lack of words is not illegibility: a blank leaf, a binding, a picture. Their English
 * is "[Blank page]" or the picture's description as a note, and withholding it would be pure loss.
 * Measured on 300 random books (2026-10-02): the first cut of this gate fired on 297 pages, and
 * blanks, covers, spines and plates were most of them — "no legible text" is how the OCR says blank.
 */
export const NOT_TEXT_PAGE_TYPES = new Set(['blank', 'cover', 'binding', 'illustration', 'plate', 'map', 'frontispiece', 'portrait', 'diagram', 'digitizer-insert', 'digitizer-notice', 'exlibris', 'bookplate']);

export const ILLEGIBLE_KINDS = Object.freeze({
  NO_LEGIBLE_BODY: 'no-legible-body',
  OCR_ILLEGIBLE: 'ocr-illegible',
  GARBLED: 'garbled-source',
});

// Metadata the OCR writes about the page rather than from it. Margins, footnotes and inserts are
// page text and stay.
const META_BLOCK_RE = /<(meta|vocab|language|lang|page-type|page-num|sig|scan-quality|script|columns|header|image-desc|folio|detected-images|catchword|warning|summary|keywords|note)\b[^>]*>[\s\S]*?<\/\1>/gi;
const UNCLEAR_RE = /<unclear\b[^>]*>[\s\S]*?<\/unclear>/gi;
// What a transcriber writes in place of text it did not read: "[...]", "[…]", "[illegible]",
// "[lacuna of 3 lines]", "[2 words effaced]", "[?]". Only a bracket whose words are ALL about loss
// is removed — "[Hermes]" or "[sic]" is text.
const LACUNA_RE = /\[(?:[\s.…·\-—–?]*|[^\]]{0,80}?\b(?:illegib\w*|unreadab\w*|indecipherab\w*|lacuna\w*|gap|lost|missing|effaced|damaged|faded|torn|obscured|erased|blank|unclear|not (?:legible|transcribed|visible))\b[^\]]{0,80})\]/gi;
// Non-global twin for presence tests: `.test()` on a /g regex is stateful.
const HAS_LACUNA_RE = new RegExp(LACUNA_RE.source, 'i');
const ELLIPSIS_RE = /(?:\.\s*){3,}|…+/g;
const LETTER_RE = /[\p{L}\p{N}]/gu;
// A Han, kana or Hangul character carries about a word; counted as three letters, so a calligraphy
// leaf of 13 legible characters (held-out round 2) is not read as empty.
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/**
 * The text of the page a reader could actually read: OCR metadata, <unclear> spans and lacuna
 * markers removed. Counted in letters and digits, so ellipses and punctuation debris cannot make
 * an empty page look full, and a legible shelfmark ("Diss. 744, 7") is not read as empty.
 */
export function legibleText(ocr) {
  return String(ocr || '')
    .replace(META_BLOCK_RE, ' ')
    .replace(UNCLEAR_RE, ' ')
    .replace(/->|<-/g, ' ')
    .replace(/<\/?[a-zA-Z][^<>]*>/g, ' ')
    .replace(LACUNA_RE, ' ')
    .replace(ELLIPSIS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export const legibleLetters = (ocr) => {
  const t = legibleText(ocr);
  return (t.match(LETTER_RE) || []).length + 2 * (t.match(CJK_RE) || []).length;
};

const warningsOf = (ocr) => [...String(ocr || '').matchAll(/<warning>([\s\S]*?)<\/warning>/gi)].map((m) => m[1].trim());
const scanQualityOf = (ocr) => (String(ocr || '').match(/<scan-quality>\s*([a-z]+)\s*<\/scan-quality>/i)?.[1] || '').toLowerCase() || null;

// The OCR says the page as a whole could not be read. Deliberately narrower than ocr-garble-score's
// READ_HARM_RE: "several lines difficult to decipher" is a caution for the reader, not a refusal.
// "No legible text" is NOT here: on 21 corpus pages it meant a blank leaf, a cover or a spine 20 times.
// Nor are "largely"/"mostly"/"much of": on held-out round 2 they fired on title pages whose title
// was read and translated. A page that is MOSTLY lost reaches the gate through (a1) instead.
const TOTAL_ILLEGIBLE_RE = /\b(?:(?:almost|nearly|virtually|practically)\s+)?(?:entirely|completely|wholly|totally)\s+(?:illegible|unreadable|indecipherable|effaced|obliterated)\b|\billegible throughout\b|\b(?:page|text|writing|script|inscription)\s+(?:is|are)\s+(?:illegible|unreadable|indecipherable)\s*(?:[.;,]|$)|\bcannot be (?:read|transcribed|deciphered)\s*(?:[.;,]|$)/i;
// …unless the claim is about a PART of the page ("the lower half is almost entirely illegible",
// "the stamp is illegible") or immediately concedes the rest is legible.
const PARTIAL_SCOPE_RE = /\b(?:upper|lower|top|bottom|left|right|half|portion|parts?|areas?|sections?|lines?|corner|edges?|margins?|marginal|column|stamp|seal|signature|bookplate|label|note|annotation|gloss|some|several|a few|certain|much|most|majority|remaining|rest)\b/i;
const STILL_LEGIBLE_RE = /\b(?:remains?|still|otherwise|fully|clearly|mostly|largely|generally)\s+(?:clear\s+and\s+)?(?:legible|readable)\b/i;
// The transcriber reported that it could not read the PAGE — not that the paper is stained or the
// photo dark (a frontispiece warning says that about a well-described plate), and not that "several
// passages are difficult to decipher" (a caution; the page was read).
const PAGE_READ_LOSS_RE = /\b(?:most|majority|much|bulk|all|entire|whole)\b[^.;]{0,60}\b(?:illegib|unreadab|indecipherab|obscured|lost)|\b(?:almost entirely|nearly entirely|largely|mostly|entirely|completely)\s+(?:illegib|unreadab|indecipherab|obscured)|beyond (?:transcription|reading|legibility)|too (?:faint|faded) to (?:read|transcribe)|lacks? sufficient contrast/i;
// An <unclear> that describes a gap ("[illegible — 2-3 words]", "...") rather than holding a best
// reading. The OCR prompt asks for best readings INSIDE <unclear> ("<unclear>מלכים</unclear>"), so
// a page whose every word is in <unclear> may still be a page that was read — measured: on 31
// corpus fires of the first cut, about half were exactly that, and their English was a translation.
const LACUNA_UNCLEAR_RE = /<unclear\b[^>]*>\s*(?:\[[^\]]*\]|[.…\s]*)\s*<\/unclear>/i;
// A warning that says what the page IS when that is not text.
const NOT_TEXT_WARNING_RE = /\bblank\b|\bcover\b|\bbinding\b|\bspine\b|fore-?edge|flyleaf|endpaper|pastedown|not a (?:text|manuscript) page|only (?:hand-drawn )?(?:sketch|drawing|illustration)/i;
// A described picture the reader is meant to see. A small low-significance symbol (a library
// stamp on a papyrus) is not a picture page.
const SIGNIFICANT_IMAGE_RE = /<image-desc\b(?![^>]*significance="low")[^>]*>|<detected-images>/i;

/**
 * Does the OCR claim the PAGE is illegible? Returns the warning text that says so, or null.
 * A warning is read sentence by sentence, so "Handwritten Greek. The papyrus is almost entirely
 * illegible." fires and "The lower margin is almost entirely illegible; the text is clear" does not.
 */
export function ocrIllegibilityClaim(ocr) {
  for (const w of warningsOf(ocr)) {
    if (STILL_LEGIBLE_RE.test(w)) continue;
    for (const s of w.split(/(?<=[.;])\s+/)) {
      if (TOTAL_ILLEGIBLE_RE.test(s) && !PARTIAL_SCOPE_RE.test(s)) return w;
    }
  }
  return null;
}

/**
 * Is this page's source illegible, under the contract above?
 *
 * @param {string} ocr  the page's `ocr.data`
 * @param {object} [opts]
 * @param {{garbled: boolean, reasons?: string[]}|null} [opts.garble]  a garble verdict a caller
 *   computed (ocr-garble-verdict.mjs needs a lexicon; this file never builds one). Absent → (b) off.
 * @param {string|null} [opts.pageType]  the page document's `page_type` (the OCR's own tag is read too)
 * @returns {{illegible: boolean, kind: string|null, reason: string|null, legibleLetters: number}}
 */
export function illegibleSourceVerdict(ocr, { garble = null, pageType = null } = {}) {
  const text = String(ocr || '');
  const letters = legibleLetters(text);
  const out = (kind, reason) => ({ illegible: !!kind, kind, reason, legibleLetters: letters });

  // Not a text page at all — a blank leaf, a binding, a picture. Nothing here is illegibility.
  const ocrType = (text.match(/<page-type>\s*([^<]*?)\s*<\/page-type>/i)?.[1] || '').toLowerCase();
  if (NOT_TEXT_PAGE_TYPES.has(String(pageType || '').toLowerCase()) || NOT_TEXT_PAGE_TYPES.has(ocrType)) return out(null, null);
  // The OCR says what the page is — in a warning, a meta, or a bracketed note in place of text
  // ("[This page is blank and contains no text]" on an endpaper, held-out round 2).
  const remarks = [...warningsOf(text), ...[...text.matchAll(/<meta>([\s\S]*?)<\/meta>/gi)].map((m) => m[1]), ...(text.replace(META_BLOCK_RE, ' ').match(/\[[^\]]{0,200}\]/g) || [])];
  if (remarks.some((w) => NOT_TEXT_WARNING_RE.test(w))) return out(null, null);

  // (a1) Nothing legible outside <unclear>, and the transcriber marked a failure to read the PAGE:
  // `poor` quality, a page-scope illegibility warning, or a gap written as a lacuna. A bare
  // <unclear> is not enough (it may hold a best reading); a described picture is the existing
  // no-body gate's case (its description becomes the reader's note) and is left alone.
  if (letters < MIN_LEGIBLE_LETTERS && !SIGNIFICANT_IMAGE_RE.test(text)) {
    const body = text.replace(META_BLOCK_RE, ' ');
    const marked = LACUNA_UNCLEAR_RE.test(body) || HAS_LACUNA_RE.test(body.replace(UNCLEAR_RE, ' '))
      || scanQualityOf(text) === 'poor' || warningsOf(text).some((w) => PAGE_READ_LOSS_RE.test(w));
    if (marked) return out(ILLEGIBLE_KINDS.NO_LEGIBLE_BODY, 'the transcription holds no legible text');
  }
  // (a2) The OCR says the page could not be read. Whatever body it wrote anyway is suspect.
  const claim = ocrIllegibilityClaim(text);
  if (claim) return out(ILLEGIBLE_KINDS.OCR_ILLEGIBLE, `the transcriber reported the page illegible (“${oneLine(claim, 160)}”)`);
  // (b) An injected garble verdict.
  if (garble?.garbled) return out(ILLEGIBLE_KINDS.GARBLED, `the transcription is garbled (${(garble.reasons || []).join(', ') || 'garble verdict'})`);
  return out(null, null);
}

function oneLine(s, max) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** The whole translation for a gated page — exactly one <warning>, nothing else (contract a/b). */
export function illegibleWarning(verdict) {
  const reason = String(verdict?.reason || 'the source could not be read').replace(/[<>]/g, '');
  return `<warning>Illegible: ${reason}</warning>`;
}

/** Is a translation exactly the contract's output? (For scoring arms and auditing writes.) */
export const isIllegibleWarningOnly = (text) => /^\s*<warning>\s*Illegible:[^<]*<\/warning>\s*$/i.test(String(text || ''));
