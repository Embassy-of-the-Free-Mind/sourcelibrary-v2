// PRIOR ART: scripts/eval/lib/production-prompt.mjs (the served v13+ prompt — long, note-asking, context-carrying;
// a student cannot be trained on it without learning the apparatus #4320's tune learned). This is the one fixed
// prompt string of #5793 and the one apparatus stripper applied alike to training targets and every arm's output.
/** The #5793 student prompt and the apparatus stripper. The Python side (box/) carries the same string verbatim. */

export const PROMPT_VERSION = 'student-5793-v1';
export const PROMPT = 'Translate this page of a historical Latin book into English. Translate all of it, faithfully, '
  + 'in plain modern English. Do not add notes, glosses or commentary.\n\n';

/**
 * Remove translator apparatus, keep the translation. Applied identically to training targets and to all arms'
 * outputs before judging, so no arm is judged with notes the others lack.
 *   removed with content: <note>, <gloss>, <meta> (continuation summaries)
 *   unwrapped (content kept): <term>, <margin>, <unclear>, <insert>, <foreign>, <italic>, <i>, <b>, <bold>, <sup>,
 *   <center>, <red>, <p> and any other tag; empty tags (<column-break/>, <br>) removed
 * KNOWN DEFECT (found after judging, kept so the run reproduces): <summary> and <keywords> are UNWRAPPED, not
 * removed. Every served/v13 output carries both, so on Gemini output this leaves a summary paragraph and a keyword
 * line in the English (#5793: 35 of lite's 41 invention flags). Training targets carry neither. Reusing this on
 * served English? Add summary|keywords to the removed set first.
 */
export function cleanTranslation(t) {
  let s = String(t || '');
  for (let i = 0; i < 3; i++) s = s.replace(/<(note|gloss|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(note|gloss|meta)\b[^>]*>[\s\S]*$/i, ''); // an unclosed one at the end
  s = s.replace(/<\/?[a-z][a-z0-9-]*\b[^>]*\/?>/gi, '');
  s = s.replace(/[ \t]+([.,;:])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return s.split('\n').map((l) => l.trimEnd()).join('\n').trim();
}
