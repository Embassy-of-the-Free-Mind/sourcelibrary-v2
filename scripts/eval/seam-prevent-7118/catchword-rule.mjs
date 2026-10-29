// PRIOR ART: seam-prompt-6742/candidate.mjs (prompt surgery on the v13 default, the A/B and a migration sharing one
// text) and translate-core PAGE_BREAK_RULE / resolvePageBreakForPage (production's catchword device: the catchword is
// removed from the page's text and named "must not be translated"). This keeps the device and changes only what the
// model is told to do with the word: label it once at the foot instead of dropping it (Derek, 2026-10-29: the books
// sometimes refer to their catchwords).
/**
 * The catchword arm (#7118): production's request plus one rule line, with the catchword sentence of PAGE_BREAK_RULE
 * and the device note reworded from "never translate it" to "do not translate it here; label it". Applied to the
 * BUILT prompt so arm A's bytes come from production code untouched.
 */
export const CATCHWORD_RULE = `**Catchwords:** a catchword is the next page's first word printed alone at the foot of a page, a guide for the binder. Keep it as a label: write it once, copied exactly as printed (not translated), as <catchword>word</catchword> on its own line at the very end of that page's English. Do not translate it on that page: the word is translated on the next page, where it stands in the sentence.`;
export const CATCHWORD_RULE_BLOCK = `**Catchwords:** a catchword is the next page's first word printed alone at the foot of a page, a guide for the binder. Keep it as a label: write it once, copied exactly as printed (not translated), as <catchword>word</catchword> on its own line at the end of that page's English, just before the next page's <pb/> marker. Do not translate it there: the word is translated after the marker, where it stands in the sentence.`;

const RULE_OLD = "a catchword (the next page's first word printed again at the foot of this page) is a printer's device, not text: never translate it.";
const RULE_NEW = "a catchword (the next page's first word printed again at the foot of this page) is a printer's device, not text of this page: do not translate it here; label it as the **Catchwords** rule says.";
const NOTE_RE = /The catchword «([^»]*)» at the foot of this page is a printer's device repeating the next page's first word: it is not text of this page and must not be translated\./g;

export function withCatchwordRule(prompt, { block = false } = {}) {
  let p = String(prompt).split(RULE_OLD).join(RULE_NEW)
    .replace(NOTE_RE, (_, w) => `The catchword «${w}» at the foot of this page is a printer's device repeating the next page's first word: it is not text of this page, so do not translate it here; write it once at the end of this page's English as <catchword>${w}</catchword>.`);
  const anchor = block ? /\n\*\*Pages to (?:translate|modernize):\*\*/ : /\n\n\*\*Text to (?:translate|modernize):\*\*/;
  const m = p.match(anchor);
  if (!m) throw new Error('catchword-rule: the text anchor was not found in the built prompt');
  return p.slice(0, m.index) + `\n\n${block ? CATCHWORD_RULE_BLOCK : CATCHWORD_RULE}${block ? "\n" : ""}` + p.slice(m.index);
}

/** The labels in a translation, and the text with them removed (what the continuous view reads). */
export const CATCHWORD_TAG = /<catchword>([\s\S]*?)<\/catchword>/gi;
export const catchwordsIn = (t) => [...String(t || '').matchAll(CATCHWORD_TAG)].map((m) => m[1].trim());
export const withoutCatchwords = (t) => String(t || '').replace(CATCHWORD_TAG, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
