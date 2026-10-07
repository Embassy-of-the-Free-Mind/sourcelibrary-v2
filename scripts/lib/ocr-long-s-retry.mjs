/**
 * ocr-long-s-retry.mjs — the RECITATION retry prompt for early print (#5521).
 *
 * PRIOR ART: scripts/eval/lib/production-prompt.mjs `withIntervention` (site a prompt change at an anchor of
 * the live prompt, or throw) and the experiment that measured this line, scripts/eval/long-s-tcp-ab.mjs
 * (#5488). Neither is importable by the workers as a production dependency of the retry tier.
 *
 * What it is for: Gemini refuses some early printed pages as RECITATION (17–20% of EEBO-referenced
 * 1500–1700 pages on the live prompt v16). Asking the model to write the printed long s (ſ) returned text
 * on 22 of the 23 pages the live prompt refused (flash-lite, paired, p = 0.002). A variant that keeps
 * "write it as s" did not, so the gain comes from the glyph, most likely because the output then differs
 * from the normalised text the recitation filter matches.
 * The house convention is long s written as s (v16 never outputs ſ), so this line is used ONLY on a
 * refusal retry, and the collector folds ſ back to s before storing. It must never go into the default
 * prompt: on Latin 1500s and German 1600–1799 it changed 25% / 17% of words.
 */

export const LONG_S_GLYPH_VARIANT = 'long-s-glyph';
export const LONG_S_ANCHOR = '**Medieval abbreviation handling:**';
export const LONG_S_LINE = '**Long s (ſ):** In print before about 1800 the long s (ſ) is the letter s, not f. It has no crossbar, or only a nub on the left side of the stem; f has a full crossbar. Transcribe it as ſ. Never output f for a long s: "ſo", "muſt", "ſhall", "firſt", "theſe" — not "fo", "muft", "fhall", "firft", "thefe".';

/** The live prompt with the long-s line sited before its anchor. Throws if the anchor is gone. */
export function withLongSLine(promptText) {
  if (!promptText.includes(LONG_S_ANCHOR)) {
    throw new Error(`long-s retry: anchor ${JSON.stringify(LONG_S_ANCHOR)} not in the OCR prompt — re-site the line, do not append it`);
  }
  return promptText.replace(LONG_S_ANCHOR, `${LONG_S_LINE}\n\n${LONG_S_ANCHOR}`);
}

/** Back to the house convention: every long s is stored as s. */
export const foldLongS = (text) => String(text ?? '').replace(/ſ/g, 's');

// Languages written in the Latin alphabet, where long s exists. The retry line is sent only for these;
// a refused Greek, Hebrew or CJK page goes to the next tier unchanged.
// Names and ISO 639-1 codes (books.language holds either; .claude/docs/invariants/language-fields.md).
const LATIN_SCRIPT_LANGUAGES = /\b(latin|english|german|french|italian|dutch|spanish|portuguese|catalan|danish|swedish|norwegian|icelandic|polish|czech|hungarian|welsh|occitan|provencal|romansh|frisian|slovenian|croatian|la|en|de|fr|it|nl|es|pt|ca|da|sv|no|is|pl|cs|hu|cy|oc|fy|sl|hr)\b/i;
export function longSRetryApplies(book) {
  return LATIN_SCRIPT_LANGUAGES.test(String(book?.language || ''));
}
