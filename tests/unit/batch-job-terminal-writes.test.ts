/**
 * Sweep (#6276): nothing writes `status: 'cancelled' | 'failed' | 'expired'` to `batch_jobs`
 * except scripts/lib/end-batch-job.mjs.
 *
 * Each of #4889, #4839 and #6238 lost billed Gemini batches the same way: a code path wrote a
 * terminal status on a submitted row without Gemini's word that the job was dead, and the
 * collector never selected the row again. endBatchJob() asks first; this test is what keeps a
 * NEW path from going around it.
 *
 * How it decides (so a reader knows what its green means):
 *   - Every tracked .js/.mjs/.ts/.tsx under scripts/ and src/, comments stripped.
 *   - Every write call (updateOne/updateMany/findOneAndUpdate/replaceOne/insertOne/insertMany/
 *     bulkWrite) whose RECEIVER is batch_jobs: `collection('batch_jobs').<write>(` inline, or a
 *     variable assigned from `collection('batch_jobs')` anywhere in the file (the hoisted idiom
 *     that blinded new-field-writes, tests-that-are-not-guards.md).
 *   - Inside the written document (the update argument; for inserts the documents), a `status:`
 *     whose value is, or contains, one of the three literals — so ternaries count. An update
 *     passed as a bare identifier is resolved to its `const x = { … }` in the same file.
 * Blind spots, stated: a status computed from a non-literal (e.g. Gemini's own state mapped by a
 * function — the batch-ocr/translate-async routes do that, and it IS Gemini's word); a collection
 * named through a constant rather than the literal 'batch_jobs'.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const HELPER = 'scripts/lib/end-batch-job.mjs';
const WRITE_RE = /\.(updateOne|updateMany|findOneAndUpdate|replaceOne|insertOne|insertMany|bulkWrite)\s*\(/g;
const TERMINAL_STATUS_RE = /(['"]?)status\1\s*:\s*(?!\{)[^,\n{}]*?['"`](cancelled|failed|expired)['"`]/;

/** Strip comments without touching `//` inside strings or URLs (good enough for this repo). */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

/** Index just past the bracket that closes the one at `open`, skipping string contents. */
function matchClose(s: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) return i + 1; }
  }
  return s.length;
}

/** Top-level comma-separated arguments of the call whose '(' is at `open`. */
function callArgs(s: string, open: number): string[] {
  const end = matchClose(s, open) - 1;
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open + 1;
  for (let i = open + 1; i < end; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) { args.push(s.slice(start, i)); start = i + 1; }
  }
  args.push(s.slice(start, end));
  return args.map((a) => a.trim()).filter(Boolean);
}

const BATCH_JOBS_COLL = /collection\(\s*['"`]batch_jobs['"`]\s*\)\s*$/;

/** Every direct terminal-status write to batch_jobs in one source text: [{ line, snippet }]. */
export function findTerminalWrites(src: string): Array<{ line: number; snippet: string }> {
  const s = stripComments(src);
  // Variables bound to the batch_jobs collection anywhere in the file.
  const vars = new Set<string>();
  for (const m of s.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?[\w.]*collection\(\s*['"`]batch_jobs['"`]\s*\)/g)) vars.add(m[1]);
  const out: Array<{ line: number; snippet: string }> = [];
  for (const m of s.matchAll(WRITE_RE)) {
    const before = s.slice(Math.max(0, m.index! - 200), m.index!).replace(/\s+$/, '');
    const recv = before.match(/(\w+)$/)?.[1];
    if (!BATCH_JOBS_COLL.test(before) && !(recv && vars.has(recv))) continue;
    const open = m.index! + m[0].length - 1;
    const args = callArgs(s, open);
    const kind = m[1];
    let docs = kind === 'insertOne' || kind === 'insertMany' || kind === 'bulkWrite' ? args.slice(0, 1) : args.slice(1, 2);
    docs = docs.map((d) => {
      if (/^\w+$/.test(d)) { // a hoisted update document: resolve `const d = { … }`
        const decl = s.match(new RegExp(`(?:const|let|var)\\s+${d}\\s*=\\s*`));
        if (decl) { const at = decl.index! + decl[0].length; return s.slice(at, matchClose(s, at)); }
      }
      return d;
    });
    for (const d of docs) {
      const hit = d.match(TERMINAL_STATUS_RE);
      if (hit) out.push({ line: s.slice(0, m.index!).split('\n').length, snippet: hit[0].slice(0, 80) });
    }
  }
  return out;
}

describe('the scanner sees each idiom a direct write could take (positive control)', () => {
  const fires = (src: string) => findTerminalWrites(src).length;
  it('inline collection, inline $set', () => {
    expect(fires(`await db.collection('batch_jobs').updateOne({ _id }, { $set: { status: 'cancelled', why: 'x' } });`)).toBe(1);
  });
  it('hoisted collection variable', () => {
    expect(fires(`const bj = db.collection("batch_jobs");\n// …\nawait bj.updateMany(f, { $set: { status: "failed" } });`)).toBe(1);
  });
  it('hoisted update document', () => {
    expect(fires(`const update = { $set: { status: 'expired', updated_at: new Date() } };\nawait db.collection('batch_jobs').updateOne(f, update);`)).toBe(1);
  });
  it('ternary value, quoted key, multi-line call', () => {
    expect(fires(`await db.collection('batch_jobs')\n  .updateOne(\n    { _id },\n    { $set: { "status": dead ? 'failed' : 'pending' } },\n  );`)).toBe(1);
  });
  it('insert of a terminal row', () => {
    expect(fires(`await db.collection('batch_jobs').insertOne({ id, status: 'cancelled' });`)).toBe(1);
  });
});

describe('the scanner does not flag what is not a terminal write to batch_jobs (negative control)', () => {
  const fires = (src: string) => findTerminalWrites(src).length;
  it('reads, other collections, comments, non-terminal statuses', () => {
    expect(fires(`await db.collection('batch_jobs').countDocuments({ status: 'failed' });`)).toBe(0);
    expect(fires(`await db.collection('batch_jobs').updateOne({ status: 'failed' }, { $set: { recovery_checked_at: now } });`)).toBe(0);
    expect(fires(`await db.collection('jobs').updateMany(f, { $set: { status: 'cancelled' } });`)).toBe(0);
    expect(fires(`await db.collection('gemini_usage').updateOne(f, { $set: { status: 'failed' } });`)).toBe(0);
    expect(fires(`// await db.collection('batch_jobs').updateOne(f, { $set: { status: 'failed' } });`)).toBe(0);
    expect(fires(`await db.collection('batch_jobs').updateOne(f, { $set: { status: 'superseded' } });`)).toBe(0);
  });
});

describe('batch_jobs terminal statuses are written only by endBatchJob (#6276)', () => {
  it('no tracked file outside the helper writes cancelled/failed/expired to batch_jobs directly', () => {
    const files = execFileSync('git', ['ls-files', 'scripts', 'src'], { encoding: 'utf8' })
      .trim().split('\n').filter((f) => /\.(m?js|cjs|ts|tsx)$/.test(f) && f !== HELPER);
    const offenders: string[] = [];
    let scanned = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('batch_jobs')) continue;
      scanned++;
      for (const w of findTerminalWrites(src)) offenders.push(`${f}:${w.line}  ${w.snippet}`);
    }
    // The sweep must actually be looking at the writers it replaced.
    expect(scanned).toBeGreaterThan(50);
    expect(offenders, `Direct terminal writes to batch_jobs — route them through endBatchJob() / endNamelessBatchJobs() in ${HELPER}:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the helper itself is still where the writes live (the sweep would be vacuous otherwise)', () => {
    const src = readFileSync(HELPER, 'utf8');
    expect(src).toMatch(/updateOne\(where, \{ \$set: \{\s*\.\.\.set, status,/);
    expect(src).toMatch(/updateMany\(where, \{ \$set: \{\s*\.\.\.set, status,/);
  });
});
