/**
 * Notebook-claim check (#6255). The Librarian's system prompt says to mention
 * the research notebook only in a turn where add_to_notebook succeeded, and the
 * model ignores it: of 136 "Saved to your research notebook" claims since
 * 2026-09-01, roughly three in four came from threads with no notebook at all,
 * and a reader who opens the button finds 0 findings. A longer prompt will not
 * fix that, so the chat loop tracks whether a save really happened this turn
 * and, when none did, this module turns every claim sentence into a deletion
 * edit. The edits ride the grounding_edits event, so the persisted message and
 * the on-screen text lose the same span.
 *
 * Claims are recognised by the button label in emphasis or quotes
 * ("*Research notebook*" — the model keeps it in English in every language it
 * answers in) or by a save verb next to the notebook (English, Spanish,
 * Chinese). Measured on embassy_messages 2026-09-01..10-10: every claim variant
 * in the data carries one of the two.
 *
 * Pure and client-safe.
 *
 * PRIOR ART: src/lib/embassy/grounding.ts — groundAnswer() only SKIPS this sentence (SKIP_PROSE); it never knows whether a save happened, so it cannot judge the claim.
 */

export interface NotebookClaimEdit {
  find: string;
  replace: string;
  at: number;
  reasons: ['notebook_claim'];
}

/** The notebook button's label, set off as a label: `*Research notebook*`, `“Research notebook”`. */
const BUTTON_LABEL = /[*_“”"'‘’「]{1,2}\s*(?:Research notebook|Cuaderno de investigación)\s*[*_“”"'‘’」]{1,2}/i;

// Within one sentence: a '.' inside a link (sourcelibrary.org) does not end it.
const SAME_SENTENCE = String.raw`(?:[^.!?\n]|[.!?](?=\S))*`;

const SAVE_CLAIMS: RegExp[] = [
  /\bsaved to (?:your|the) (?:research )?notebook\b/i,
  new RegExp(String.raw`\b(?:saved|added|stored|recorded)\b${SAME_SENTENCE}\bto (?:your|the) (?:research )?notebook\b`, 'i'),
  new RegExp(String.raw`\b(?:guardad[oa]s?|añadid[oa]s?|agregad[oa]s?|he (?:añadido|guardado|agregado))\b${SAME_SENTENCE}\bcuaderno\b`, 'i'),
  /(?:保存|记录|存入)[^。！？\n]*(?:笔记本|研究笔记)/,
];

export function isNotebookClaim(sentence: string): boolean {
  return BUTTON_LABEL.test(sentence) || SAVE_CLAIMS.some(re => re.test(sentence));
}

/** Sentence spans [start, end) within one line; `end` includes trailing whitespace. */
function sentenceSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /[.!?。！？]+(?=\s|$)\s*/g;
  let start = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const end = m.index + m[0].length;
    spans.push([start, end]);
    start = end;
  }
  if (start < line.length) spans.push([start, line.length]);
  return spans;
}

/**
 * Deletion edits, in document order, for every notebook-claim sentence in
 * `text`. A line made only of claims goes with its newline; a claim inside a
 * longer paragraph goes with the space after it (or before it, when it ends
 * the line). Call only when add_to_notebook did NOT succeed this turn.
 */
export function notebookClaimEdits(text: string): NotebookClaimEdit[] {
  const edits: NotebookClaimEdit[] = [];
  let lineStart = 0;
  for (const line of text.split('\n')) {
    const spans = sentenceSpans(line).filter(([s, e]) => line.slice(s, e).trim() !== '');
    const claims = spans.map(([s, e]) => isNotebookClaim(line.slice(s, e)));
    if (spans.length > 0 && claims.every(Boolean)) {
      const hasNewline = lineStart + line.length < text.length;
      const find = text.slice(lineStart, lineStart + line.length + (hasNewline ? 1 : 0));
      edits.push({ find, replace: '', at: lineStart, reasons: ['notebook_claim'] });
    } else {
      // Merge runs of adjacent claim sentences into one edit.
      let i = 0;
      while (i < spans.length) {
        if (!claims[i]) { i++; continue; }
        let j = i;
        while (j + 1 < spans.length && claims[j + 1]) j++;
        let s = spans[i][0];
        const e = spans[j][1];
        // Ending the line: take the whitespace before it instead of leaving a trailing space.
        if (j === spans.length - 1) while (s > 0 && /\s/.test(line[s - 1])) s--;
        edits.push({ find: line.slice(s, e), replace: '', at: lineStart + s, reasons: ['notebook_claim'] });
        i = j + 1;
      }
    }
    lineStart += line.length + 1;
  }
  return edits;
}

/**
 * Merge notebook-claim edits into the grounding pass's edits, keeping document
 * order. A claim edit that overlaps a grounding edit is dropped — the grounding
 * pass already rewrote that span, and two edits over one span cannot both apply.
 */
export function mergeNotebookClaimEdits<E extends { find: string; at: number }>(
  grounding: E[],
  claims: NotebookClaimEdit[],
): Array<E | NotebookClaimEdit> {
  const overlaps = (a: { find: string; at: number }, b: { find: string; at: number }) =>
    a.at < b.at + b.find.length && b.at < a.at + a.find.length;
  const kept = claims.filter(c => !grounding.some(g => overlaps(g, c)));
  return [...grounding, ...kept].sort((a, b) => a.at - b.at);
}
