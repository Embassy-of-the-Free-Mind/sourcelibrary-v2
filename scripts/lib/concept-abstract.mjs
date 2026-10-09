/**
 * PRIOR ART: scripts/eval/embed-granularity/arm-c-abstracts.mjs — the #6173 pilot,
 * where this prompt was written and scored (arm `c`). It held the prompt inline in
 * a script with top-level side effects, so the stage-1 lane could not import it;
 * the text moved here VERBATIM (same PROMPT_VERSION) and the pilot imports it back.
 * Nothing else in scripts/lib writes or parses a page abstract.
 *
 * The concept abstract (#6173): 2–4 plain sentences per page stating its ideas in
 * neutral modern language, with no technical terms and no proper names, so a
 * concept query can find the same idea in several traditions. It is an INDEX KEY,
 * never a quotation: it is embedded, and a reader is always shown the page itself
 * (`quote-and-snippet-integrity.md`).
 */

export const CONCEPT_ABSTRACT_MODEL = 'gemini-3.1-flash-lite';
export const CONCEPT_ABSTRACT_PROMPT_VERSION = 'concept-abstract-v1';
/** Pages per request in the pilot. The head is ~330 tokens, so fewer pages per call pays it more often. */
export const CONCEPT_ABSTRACT_PAGES_PER_CALL = 6;
/** The pilot cut each page at 6,000 characters of the composed (cleaned) page text. */
export const CONCEPT_ABSTRACT_MAX_PAGE_CHARS = 6000;
/** Exactly what the pilot sent: temperature 0, 1,200 output tokens, thinking off (gemini-script-client's default). */
export const CONCEPT_ABSTRACT_GEN_CONFIG = Object.freeze({ temperature: 0, maxOutputTokens: 1200, thinkingConfig: Object.freeze({ thinkingBudget: 0 }) });

export const CONCEPT_ABSTRACT_HEAD = `You index pages of historical religious, philosophical and scientific texts so that readers can find the same IDEA across different traditions.

For each numbered page below, write 2 to 4 plain sentences stating the ideas on that page: what it claims or shows about reality, the divine, the self or soul, knowledge, practice, nature or ethics. If the page is narrative, ritual or recipe, say what is done and what it is taken to mean.

Rules:
- Use neutral modern language that a student of ANY tradition would recognise. Do not use the tradition's own technical terms, and do not use proper names, titles of works, or the names of gods, sages, schools or religions. Say what a term means instead of naming it.
- State the idea itself, not that "the text discusses" it.
- Use only what is on the page. Do not add background you know from elsewhere.
- If a page has no ideas to state (an index, a title page, a table, a bare list of names), write NONE.

Answer with one line per page, in order, in exactly this form:
[1] <abstract>
[2] <abstract>
`;

/** The page text as sent: the composed page text, cut where the pilot cut it. */
export const abstractInputText = (text) => String(text || '').slice(0, CONCEPT_ABSTRACT_MAX_PAGE_CHARS);

/** One request's prompt for `texts` (already cut with abstractInputText). */
export function buildConceptAbstractPrompt(texts) {
  return CONCEPT_ABSTRACT_HEAD + '\n' + texts.map((t, j) => `=== PAGE ${j + 1} ===\n${t}`).join('\n\n');
}

/**
 * Parse a response for a request of `n` pages. Returns the n abstracts in order,
 * or null when any page is unanswered: a short answer would otherwise shift
 * abstracts onto the wrong page, so the whole request is discarded.
 */
export function parseConceptAbstracts(text, n) {
  const lines = new Map();
  for (const m of String(text || '').matchAll(/^\[(\d+)\]\s*(.+)$/gm)) lines.set(Number(m[1]), m[2].trim());
  const out = [];
  for (let j = 1; j <= n; j++) {
    if (!lines.has(j)) return null;
    out.push(lines.get(j));
  }
  return out;
}

/** The model's "this page has no ideas" answer. Such pages are stored but never embedded. */
export const isNoneAbstract = (a) => /^NONE\b/i.test(String(a || '').trim());
