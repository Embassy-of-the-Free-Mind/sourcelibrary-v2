/**
 * PRIOR ART: scripts/maintenance/withdraw-fabricated-translation-4584.mjs replaces invented spans
 * with `<lacuna>` by exact match, but it is a one-off sweep with its own inline matcher, not a
 * reusable function; src/app/api/pages/[id]/route.ts takes a WHOLE replacement text, which would
 * drop the editorial wrappers a volunteer never saw. none other — looked in scripts/lib, src/lib
 * for "span", "replace", "edit".
 *
 * Volunteer corrections as span edits (#6418).
 *
 * A review shift shows the volunteer page text with the editorial wrappers stripped
 * (`stripEditorialWrappers`). If a correction were a retyped page, applying it would silently
 * delete the stored wrappers — the OCR page-type envelope, the translation's <meta>/<summary>
 * blocks — that other code reads. So a correction is a list of `{ find, replace }` pairs applied
 * to the STORED raw text, each `find` required to occur exactly once. That is also how an expert
 * corrects ("this word should be X"), and a short diff is what a second reader can check.
 *
 * Used by the proposal route (src/app/api/review/corrections) to validate at submit time and by
 * scripts/maintenance/apply-page-correction.mjs to apply. Pure: no DB, no I/O.
 */

export const MAX_EDITS = 30;
export const MAX_FIND = 2000;
export const MAX_REPLACE = 4000;

function countOccurrences(haystack, needle) {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/**
 * Normalise caller input into a clean edit list, or return an error string.
 * @param {unknown} raw
 * @returns {{ edits: Array<{find: string, replace: string, reason: string|null}> } | { error: string }}
 */
export function normalizeEdits(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'edits must be a non-empty array' };
  if (raw.length > MAX_EDITS) return { error: `at most ${MAX_EDITS} edits per proposal` };
  const edits = [];
  for (const [i, e] of raw.entries()) {
    const find = typeof e?.find === 'string' ? e.find : '';
    const replace = typeof e?.replace === 'string' ? e.replace : null;
    if (!find.trim()) return { error: `edit ${i + 1}: find is empty` };
    if (replace === null) return { error: `edit ${i + 1}: replace must be a string (use "" to delete)` };
    if (find.length > MAX_FIND) return { error: `edit ${i + 1}: find is over ${MAX_FIND} characters; use a shorter exact span` };
    if (replace.length > MAX_REPLACE) return { error: `edit ${i + 1}: replace is over ${MAX_REPLACE} characters` };
    if (find === replace) return { error: `edit ${i + 1}: find and replace are identical` };
    const reason = typeof e?.reason === 'string' && e.reason.trim() ? e.reason.trim().slice(0, 500) : null;
    edits.push({ find, replace, reason });
  }
  return { edits };
}

/**
 * Apply edits to `text`. Every `find` must occur exactly once in the ORIGINAL text, and no two
 * finds may overlap, so the result does not depend on the order the edits were listed in.
 * @param {string} text
 * @param {Array<{find: string, replace: string}>} edits
 * @returns {{ text: string } | { error: string }}
 */
export function applySpanEdits(text, edits) {
  const located = [];
  for (const [i, e] of edits.entries()) {
    const n = countOccurrences(text, e.find);
    if (n === 0) return { error: `edit ${i + 1}: "${e.find.slice(0, 60)}" is not in the stored text (quote it exactly, or choose a shorter span)` };
    if (n > 1) return { error: `edit ${i + 1}: "${e.find.slice(0, 60)}" occurs ${n} times; include more surrounding words so it is unique` };
    const start = text.indexOf(e.find);
    located.push({ start, end: start + e.find.length, replace: e.replace, i });
  }
  located.sort((a, b) => a.start - b.start);
  for (let k = 1; k < located.length; k++) {
    if (located[k].start < located[k - 1].end) {
      return { error: `edits ${located[k - 1].i + 1} and ${located[k].i + 1} overlap; merge them into one edit` };
    }
  }
  let out = '';
  let cursor = 0;
  for (const l of located) {
    out += text.slice(cursor, l.start) + l.replace;
    cursor = l.end;
  }
  out += text.slice(cursor);
  return { text: out };
}
