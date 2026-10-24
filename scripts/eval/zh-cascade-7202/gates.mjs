// PRIOR ART: scripts/eval/translation-model-ab.mjs proseBody() / cjkCount() / scoreArm() (#4925 / 2026-09-14: the
// untranslated-CJK residue and English-chars-per-CJK-char measures), copied here because that file runs its CLI on
// import. The four gates and their thresholds are the ones fixed in #7202 before any arm ran.
/**
 * The cascade's mechanical gates (#7202). A page whose cheap-model English fails ANY gate is routed to Flash.
 *   G1 residue    untranslated CJK share of the source > 2 % (CJK left in the prose once <note>/<term>/… are removed)
 *   G2 length     English prose chars per source CJK char outside [P5, P95] of the flash arm's ratio on the 40 Siku pages
 *   G3 negation   the source has negation markers (不 弗 未 毋 勿 非 莫 無) and the English has fewer than half as many
 *                 negation words (not, no, never, nor, neither, none, nothing, nobody, nowhere, without, cannot, n't)
 *   G4 kanripo    Siku only: the page is flagged by the Kanripo QA screen (Dice < 0.6)
 *   (and an empty or failed read is always routed)
 */
const CJK_RE = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2A6DF}\u{2A700}-\u{2EBEF}\u{30000}-\u{3134F}]/gu;
export const cjkCount = (s) => ((s || '').match(CJK_RE) || []).length;
const WRAPPERS = 'meta|summary|keywords|warning|vocab|language|lang|page-type|page-num|sig|scan-quality|script|columns|header|image-desc|note|term|gloss';
export function proseBody(text) {
  return (text || '')
    .replace(new RegExp(`<(${WRAPPERS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/->|<-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The prompt addition for the DeepSeek and Qwen arms (#7202), appended after the v13 prompt. */
export const RESIDUE_RULE = '**Translate everything.** Render every sentence, clause, list item and line of the source into English, the small-print commentary included. Never leave a passage, phrase or line of the source in Chinese characters in the running translation: Chinese characters may appear only inside a <term> or a <note> that cites the original.';

export const SRC_NEG = /[不弗未毋勿非莫無]/g;
export const ENG_NEG = /\b(?:not|no|never|nor|neither|none|nothing|nobody|nowhere|without|cannot)\b|n't\b/gi;
export const RESIDUE_MAX = 0.02;
export const NEG_MIN_SHARE = 0.5;

export function measures(text, source) {
  const prose = proseBody(text);
  const srcCjk = cjkCount(source);
  return {
    prose_chars: prose.length,
    residue: srcCjk ? cjkCount(prose) / srcCjk : 0,
    ratio: srcCjk ? prose.length / srcCjk : null,
    src_neg: (String(source || '').match(SRC_NEG) || []).length,
    eng_neg: (prose.match(ENG_NEG) || []).length,
  };
}

/** Linear-interpolated percentile (q in 0..1) of a numeric array. */
export function percentile(xs, q) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const h = (a.length - 1) * q, lo = Math.floor(h);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (h - lo);
}

/** Which gates a cheap-model read fails. `band` = [P5, P95] of Flash's ratio on the Siku pages; `flagged` = Kanripo flag. */
export function gatesFailed(text, source, { band, flagged = false }) {
  if (!String(text || '').trim()) return ['empty'];
  const m = measures(text, source);
  const out = [];
  if (m.residue > RESIDUE_MAX) out.push('residue');
  if (m.ratio == null || m.ratio < band[0] || m.ratio > band[1]) out.push('length');
  if (m.src_neg > 0 && m.eng_neg < NEG_MIN_SHARE * m.src_neg) out.push('negation');
  if (flagged) out.push('kanripo');
  return out;
}
