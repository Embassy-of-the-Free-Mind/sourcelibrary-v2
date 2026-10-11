import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Sweep guard for #4272: every `$strLenCP` in src/ and scripts/ must be type-guarded.
 *
 * Some `pages` rows carry a NON-string `ocr.data` / `translation.data`, and
 * `$strLenCP` throws server-side on anything that is not a string (code 34471,
 * measured on Atlas 2026-10-11 with `$documents`), aborting the WHOLE aggregation
 * or count — #4269 hit it in production on Kircher's Oedipus Aegyptiacus. Two
 * forms look safe and are not:
 *   - `{ $strLenCP: { $ifNull: [f, ''] } }` — $ifNull substitutes only for
 *     missing/null; an object or number passes straight through and throws.
 *   - a `$type: 'string'` clause in the SAME $match as an `$expr` — Mongo
 *     evaluates the $expr per document regardless.
 * Safe forms (both verified, project/group/$expr):
 *   - `{ $cond: [{ $eq: [{ $type: f }, 'string'] }, { $strLenCP: f }, 0] }`
 *   - `{ $strLenCP: { $cond: [{ $eq: [{ $type: f }, 'string'] }, f, ''] } }`
 *   - `{ $and: [{ $eq: [{ $type: f }, 'string'] }, { $gt: [{ $strLenCP: f }, 0] }] }`
 *     ($and short-circuits).
 *
 * The check: a `$type` must appear just before or just after each `$strLenCP`.
 * Where the operand is a string by construction (an earlier `$match` stage on
 * `$type: 'string'`, a `$toString`, a literal), put `// strlen-safe: <why>` on one
 * of the three lines above the call.
 */

const ROOT = path.resolve(__dirname, '../..');
const BEFORE = 120;
const AFTER = 60;

interface Hit { file: string; line: number; text: string }

function unguardedSites(file: string, src: string): Hit[] {
  const lines = src.split('\n');
  const hits: Hit[] = [];
  const re = /\$strLenCP/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const lineNo = src.slice(0, m.index).split('\n').length;
    const text = lines[lineNo - 1];
    const trimmed = text.trim();
    // Prose about the operator, not a use of it.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    const window = src.slice(Math.max(0, m.index - BEFORE), m.index + AFTER);
    if (window.includes('$type')) continue;
    const above = lines.slice(Math.max(0, lineNo - 4), lineNo).join('\n');
    if (above.includes('strlen-safe:')) continue;
    hits.push({ file, line: lineNo, text: trimmed.slice(0, 160) });
  }
  return hits;
}

function sourceFiles(): string[] {
  return execFileSync('git', ['ls-files', 'src', 'scripts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(m?[jt]sx?|cjs)$/.test(f));
}

describe('$strLenCP type guard (#4272)', () => {
  it('every $strLenCP in src/ and scripts/ is guarded by $type or marked strlen-safe', () => {
    const files = sourceFiles();
    // Pin that the sweep actually saw the tree — an empty ls-files would pass vacuously.
    expect(files.length).toBeGreaterThan(500);
    const bad = files.flatMap((f) => {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      return src.includes('$strLenCP') ? unguardedSites(f, src) : [];
    });
    expect(bad.map((h) => `${h.file}:${h.line}  ${h.text}`)).toEqual([]);
  });

  it('flags the two forms that look safe but throw (negative control)', () => {
    const ifNull = `x: { $strLenCP: { $ifNull: ['$translation.data', ''] } },`;
    const bare = `{ $gt: [{ $strLenCP: '$ocr.data' }, 0] },`;
    expect(unguardedSites('a.ts', ifNull)).toHaveLength(1);
    expect(unguardedSites('b.ts', bare)).toHaveLength(1);
  });

  it('accepts the guarded forms and the marker', () => {
    const outer = `{ $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] }`;
    const inner = `{ $strLenCP: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] } }`;
    const marked = `// strlen-safe: $toString output\n{ $strLenCP: '$lib' }`;
    const prose = `// $strLenCP throws on non-strings`;
    for (const s of [outer, inner, marked, prose]) expect(unguardedSites('c.ts', s)).toEqual([]);
  });
});
