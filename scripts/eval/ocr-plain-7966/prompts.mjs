// PRIOR ART: scripts/eval/plain-6728/prompts.mjs and scripts/eval/translation-notes-free/run-arms.mjs (#5919, #6728):
// the PLAIN list of anchored in-memory edits to the live TRANSLATION prompt, each anchor found exactly once or throw,
// no prompt row seeded. This is the same pattern on the OCR side; no earlier eval edits the OCR prompt's extras
// (scripts/eval/lib/production-prompt.mjs `withIntervention` only inserts before an anchor, it cannot remove one).
/**
 * #7966 arms over the live default OCR prompt (`prompts` type=ocr, is_default, highest version: Standard OCR v19.1,
 * content_hash 9d8f959e053491362b2c4acec1e20c9a at the time of the pre-registration).
 *   A  = the live text, as each lane composes it (lite: + Document context; agy: + cli-ocr's image instruction)
 *   A2 = A again (fresh calls: the noise floor)
 *   B  = A without <note>, <vocab> and <term>
 *   C  = B, and <image-desc> prose replaced by a bare <image/> marker (layout kept, no description)
 * Transcription tags (margin, gloss, insert, unclear, header, page-num, sig, columns, column-break), the required
 * classifiers (scan-quality, language, script, page-type), <meta> and <warning> stay in every arm.
 */
import crypto from 'node:crypto';

export const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
export const LIVE_HASH = '9d8f959e053491362b2c4acec1e20c9a';   // content_hash of the DB row (raw content, before the slot)

/** B: each [find, replace] must match exactly once in the live v19.1 text. */
export const B_EDITS = [
  ['- <vocab>X</vocab> — key terms for indexing\n', ''],
  ['- <note>X</note> — interpretive notes for readers\n', ''],
  ['- <term>X</term> — technical vocabulary\n', ''],
  ['\n7. End with <vocab>key terms, names, concepts on this page</vocab>', ''],
];
/** C = B + these. */
export const C_EDITS = [
  ['- <image-desc size="large|medium|small" type="woodcut|engraving|diagram|emblem|portrait|map|decorative|symbol" significance="high|low">description</image-desc> — for EVERY illustration, diagram, chart, or decorative element. Size: large (>quarter page), medium (prominent but partial), small (minor initials, ornaments). Significance: high (illustrations, diagrams, emblems, figures, maps), low (decorative initials, borders, printer\'s marks, ornaments)',
    '- <image/> — a bare marker where an illustration, diagram, chart or decorative element stands. Do not describe the image.'],
  ['6. Describe any images/diagrams with <image-desc>...</image-desc> using prose, never tables',
    '6. Mark each image/diagram with a bare <image/> where it stands; never describe it, never a table'],
  ['not only in <meta> or <image-desc>.', 'not only in <meta>.'],
];

export function applyEdits(text, edits, label) {
  let out = text;
  for (const [find, repl] of edits) {
    const n = out.split(find).length - 1;
    if (n !== 1) throw new Error(`${label}: anchor found ${n} times (need exactly 1): ${JSON.stringify(find.slice(0, 60))}`);
    out = out.replace(find, () => repl);
  }
  return out;
}

/** The arm's prompt body from the live base (slot already filled). */
export function armPrompt(base, arm) {
  if (arm === 'A' || arm === 'A2') return base;
  const b = applyEdits(base, B_EDITS, 'B');
  if (arm === 'B') return b;
  if (arm === 'C') return applyEdits(b, C_EDITS, 'C');
  throw new Error(`unknown arm ${arm}`);
}
export const ARMS = ['A', 'A2', 'B', 'C'];

/** After an arm is built, the removed instructions must be gone (a guard against a partial edit). */
export function assertArm(text, arm) {
  const has = (re) => re.test(text);
  if (arm === 'B' || arm === 'C') for (const t of ['<vocab>', '<note>', '<term>']) if (text.includes(t)) throw new Error(`${arm} still mentions ${t}`);
  if (arm === 'C' && text.includes('image-desc')) throw new Error('C still mentions image-desc');
  for (const t of ['<margin>', '<gloss>', '<insert>', '<unclear>', '<header>', '<page-num>', '<sig>', '<columns>', '<column-break/>', '<scan-quality>', '<language>', '<script>', '<page-type>', '<meta>', '<warning>'])
    if (!text.includes(t)) throw new Error(`${arm} lost ${t}`);
  return has(/./);
}
