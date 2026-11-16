/**
 * The probe for files that write or clear page TEXT (`pages.ocr`, `pages.translation`).
 *
 * One probe, two tests: text-writers-use-provenance-builder.test.ts (#4613 the provenance builder, #7058
 * writePageText) and page-text-doors.test.ts (v2#8590, website routes). Moved here unchanged from the first of
 * those so the second does not grow its own copy that drifts.
 *
 * It is a heuristic over source lines. It sees: a `'ocr.data': value` / `'translation.data': value` key, a `data:`
 * key under an `ocr` / `translation` parent, a `$unset` or empty `$set` of either field, an update document built by
 * assignment (`x['ocr.data'] = …`), and a computed `[`${field}.data`]: value` key. It does NOT see: a computed key
 * with a dotted expression (`${revision.field}.data`), a field name that arrives at run time, or a write made by a
 * function the file calls in another module. It over-matches a few readers; the lists that use it say which.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO = path.resolve(__dirname, '../..');

export const OCR_WRITE = /(?:'ocr\.data':\s*(?!null\b|undefined\b|''|\{|regexFilter)[A-Za-z(]|^\s*data:\s*(?:text|ocrText|result\.text|ocrResult\.text|v\.text|art\.atf|leaves\[k\])\b)/;
export const TR_WRITE = /(?:'translation\.data':\s*(?!null\b|undefined\b|''|\{|regexFilter|r\b|\d)[A-Za-z(]|^\s*data:\s*(?:text|clean|translation|translatedText|result\.text|res\.text|english)\b)/;
export const OCR_PARENT = /\bocr\b\s*[:=]|'ocr'/;
export const TR_PARENT = /\btranslation\b\s*[:=]|'translation'/;

export function writesText(lines: string[], re: RegExp, parent: RegExp): boolean {
  return lines.some((l, i) => {
    if (!re.test(l)) return false;
    if (/'(ocr|translation)\.data'/.test(l)) return true;
    return lines.slice(Math.max(0, i - 8), i).some((prev) => parent.test(prev));
  });
}

const CLEAR_FIELD = /['"]?\b(ocr|translation)(\.data)?['"]?\s*:/;
const SET_EMPTY = /['"](ocr|translation)\.data['"]\s*:\s*(null|''|""|undefined)\b/;
/** `x['ocr.data'] = …` / `x[`${field}.data`] = …` — an update doc assembled by assignment. */
const ASSIGN_TEXT = /\[\s*(['"](ocr|translation)(\.data)?['"]|`\$\{\w+\}\.data`)\s*\]\s*=(?!=)/;
/** `[`${field}.data`]: text` — a computed-key write (not a `{ $exists … }` filter). */
const COMPUTED_KEY_TEXT = /\[`\$\{\w+\}\.data`\]\s*:\s*(?!null\b|undefined\b|''|\{)[A-Za-z(]/;
/** `ocr: { data: … }` / `translation: {` — a whole-field set. */
const WHOLE_FIELD = /(^|[\s{,])['"]?(ocr|translation)['"]?\s*:\s*\{/;

export function clearsText(lines: string[]): boolean {
  return lines.some((l, i) => {
    const ctx = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (/\$unset/.test(ctx) && CLEAR_FIELD.test(l)) return true;
    if (/\$set/.test(ctx) && (SET_EMPTY.test(l) || WHOLE_FIELD.test(l) || COMPUTED_KEY_TEXT.test(l))) return true;
    if (ASSIGN_TEXT.test(l)) return true;
    return false;
  });
}

/** Does this source write or clear page text itself (not through writePageText)? */
export function writesOrClearsPageText(src: string): boolean {
  const lines = src.split('\n');
  return writesText(lines, OCR_WRITE, OCR_PARENT) || writesText(lines, TR_WRITE, TR_PARENT) || clearsText(lines);
}

/** Tracked files under scripts/ and src/ that write or clear page text themselves; archived code and tests are left out. */
export function pageTextWriterFiles(): string[] {
  let files: string[] = [];
  try {
    files = execFileSync('git', ['grep', '-lE', String.raw`ocr|translation`, '--', 'scripts', 'src'], { cwd: REPO, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch { return []; }
  return files.filter((f) => {
    if (/^scripts\/(_archived|output)\//.test(f) || /\/_archived\//.test(f) || /\.test\.[jt]sx?$/.test(f) || !/\.(m?[jt]sx?|cjs)$/.test(f)) return false;
    if (f === 'scripts/lib/page-text-writer.mjs' || f === 'src/lib/page-text-writer.ts') return false;
    return writesOrClearsPageText(readFileSync(path.join(REPO, f), 'utf8'));
  });
}

export const usesPageTextWriter = (src: string) => /page-text-writer(\.mjs)?['"]/.test(src) && /\bwritePageText\s*\(/.test(src);
