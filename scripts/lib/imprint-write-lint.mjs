// PRIOR ART: scripts/audit/new-field-writes.mjs — the same static pass over `books` writes, but it asks "is this
// column known?", and every imprint field is known. scripts/lib/books-set-attribution.mjs is reused here for the
// literal `$set` case; on its own it found 4 of the ~30 files that write these fields, because most build the update
// object first (`update.place_published = …`, or an allowlist copied into `$set: updates`).
/**
 * Where does a source file write an IMPRINT field on `books` without going through setCatalogueFields()? (#6327)
 *
 * Three shapes, each a real idiom in this repo:
 *   $set     books.updateOne(f, { $set: { year: y } })               — literal key, attributed by books-set-attribution
 *   assign   update.place_published = p;  /  set['publisher'] = p   — the update object built field by field
 *   listed   const allowedFields = ['title', 'place_published', …] — an allowlist copied into `$set: updates`
 *                                                                     (src/app/api/books/[id]/route.ts)
 * Only files that open the `books` collection are scanned. `assign` and `listed` are not attributed to a write call,
 * so they over-report by design; the baseline absorbs today's, and a line that is not a books write can say so with
 * an `imprint-write-ok: <reason>` comment on the same or the preceding line — visible in review, unlike a silent pass.
 *
 * STILL NOT SEEN: an update built in another file, a computed key (`$set: { [f]: v }`), an insert. It is a lint.
 */
import { booksSetBlocks, topKeys } from './books-set-attribution.mjs';
import { CATALOGUE_FIELDS } from './catalogue-fields.mjs';

// The gate covers every field setCatalogueFields() writes: the imprint family (#6327) and title/author (#7673).
// The file keeps its imprint- name so the CI step, the baseline and the pragma stay where people already look.
export const IMPRINT_FIELDS = CATALOGUE_FIELDS;

/** The helper and the libraries it is built from; everything else writes through them. */
export const IMPRINT_WRITE_EXEMPT = new Set([
  'scripts/lib/catalogue-fields.mjs',
  'scripts/lib/imprint-write-lint.mjs',
]);

export const TOUCHES_BOOKS_RE = /collection(?:<[^>()]*>)?\(\s*['"`]books['"`]\s*\)/;

const ALT = IMPRINT_FIELDS.join('|');
const ASSIGN_RE = new RegExp(String.raw`([\w$]+)[\])]?\s*(?:\.\s*(${ALT})|\[\s*['"\`](${ALT})['"\`]\s*\])\s*(?:=(?![=>])|\?\?=|\|\|=)`, 'g');
// Receivers that hold a stamp or a query, not the value: `provenance.year = {…}`, `filter.published = y`.
const NOT_A_VALUE_RE = /prov|filter|query|match|where|criteria|projection|sort|cond/i;
// An array is a write allowlist when its binding says so (`allowedFields`, `EDITABLE`, `writableKeys`); a select
// list, a projection or a CSV header is not, and flagging those would teach everyone to ignore the gate.
const ALLOWLIST_NAME_RE = /allow|writ|edit|updat|patch|settable|mutable/i;
const STRING_RE = new RegExp(String.raw`['"\`](${ALT})['"\`]`, 'g');
const PRAGMA_RE = /imprint-write-ok:\s*\S/;

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

function pragmaAt(lines, line) {
  return PRAGMA_RE.test(lines[line - 1] || '') || PRAGMA_RE.test(lines[line - 2] || '');
}

/** If the string literal at `index` is an element of an array literal, the index of its `[`; else -1. */
function enclosingArray(src, index) {
  let depth = 0;
  for (let i = index - 1, n = 0; i >= 0 && n < 4000; i--, n++) {
    const c = src[i];
    if (c === ']' || c === '}' || c === ')') depth++;
    else if (c === '[' || c === '{' || c === '(') {
      if (depth === 0) {
        if (c !== '[') return -1;
        // `obj['publisher']` is a member access, not an array — handled by ASSIGN_RE when it is written to.
        const prev = src.slice(0, i).trimEnd().slice(-1);
        return /[\w$\])]/.test(prev) ? -1 : i;
      }
      depth--;
    }
  }
  return -1;
}

/** The name the array opening at `open` is bound to (`const allowedFields: string[] = [`), or ''. */
function bindingName(src, open) {
  const m = /(?:const|let|var)\s+([\w$]+)[^=;]{0,80}=\s*$/.exec(src.slice(Math.max(0, open - 200), open));
  return m ? m[1] : '';
}

/**
 * Imprint writes in one file's source. Returns [] for a file that never opens `books`.
 * @returns {Array<{line: number, field: string, how: '$set'|'assign'|'listed'}>}
 */
export function imprintWritesIn(src) {
  if (!TOUCHES_BOOKS_RE.test(src)) return [];
  const lines = src.split('\n');
  const out = [];
  const seen = new Set();
  const add = (line, field, how) => {
    const k = `${line}:${field}`;
    if (seen.has(k) || pragmaAt(lines, line)) return;
    seen.add(k);
    out.push({ line, field, how });
  };
  for (const { index, body } of booksSetBlocks(src).sets) {
    for (const k of topKeys(body)) {
      const root = k.split('.')[0];
      if (IMPRINT_FIELDS.includes(root)) add(lineOf(src, index), root, '$set');
    }
  }
  for (const m of src.matchAll(ASSIGN_RE)) {
    if (!NOT_A_VALUE_RE.test(m[1])) add(lineOf(src, m.index), m[2] || m[3], 'assign');
  }
  for (const m of src.matchAll(STRING_RE)) {
    const open = enclosingArray(src, m.index);
    if (open > -1 && ALLOWLIST_NAME_RE.test(bindingName(src, open))) add(lineOf(src, m.index), m[1], 'listed');
  }
  return out.sort((a, b) => a.line - b.line);
}

/** A violation's identity is file + field, not line: an unrelated edit above it must not read as a new write. */
export const imprintWriteId = (file, field) => `${file}::${field}`;
