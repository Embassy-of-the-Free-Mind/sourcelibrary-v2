/**
 * Every `batch_jobs` writer stamps `submitted_by` (#5498).
 *
 * Measured 2026-10-01 over 30 days of OCR jobs: most duplicate submissions — the
 * ones that were paid twice — carried no `submitted_by`, so a paid job could not
 * be attributed to the code that sent it. Two of the three orchestrator insert
 * sites stamped it; the other writers (bulk scripts, admin routes, multi-page
 * routes) did not.
 *
 * Source-level: finds every `collection('batch_jobs').insertOne(...)` in tracked
 * code, resolves the inserted object (an inline literal, or a `const x = {...}`
 * declared in the same file), and asserts the literal names `submitted_by`. A new
 * writer that forgets it fails here, before it can write an unattributable row.
 * `_archived` route folders are excluded: Next.js does not route them.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');

/** Text of the balanced `{...}` or `(...)` starting at `open`. */
function balanced(src: string, open: number): string {
  const pairs: Record<string, string> = { '{': '}', '(': ')' };
  const close = pairs[src[open]];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced from ${open}`);
}

type Site = { file: string; line: number; body: string };

function insertSites(): Site[] {
  const files = execSync(`git grep -lE "batch_jobs['\\"]\\)\\s*\\.insert(One|Many)" -- scripts src`, { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean).filter((f) => !f.includes('/_archived/'));
  const sites: Site[] = [];
  for (const file of files) {
    const src = readFileSync(path.join(root, file), 'utf8');
    const re = /batch_jobs['"]\)\s*\.insert(?:One|Many)\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const argStart = m.index + m[0].length;
      const line = src.slice(0, m.index).split('\n').length;
      let body: string;
      if (src[argStart] === '{' || src[argStart] === '[') {
        body = src[argStart] === '{' ? balanced(src, argStart) : src.slice(argStart, argStart + 4000);
      } else {
        const name = src.slice(argStart).match(/^\s*(\w+)/)?.[1];
        const decl = name ? new RegExp(`(?:const|let|var)\\s+${name}\\b[^=]*=\\s*\\{`).exec(src) : null;
        body = decl ? balanced(src, decl.index + decl[0].length - 1) : `<unresolved ${name}>`;
      }
      sites.push({ file, line, body });
    }
  }
  return sites;
}

describe('batch_jobs writers stamp submitted_by', () => {
  const sites = insertSites();

  it('finds the known writers (positive control)', () => {
    // If the scan matches nothing, every assertion below passes vacuously.
    expect(sites.length).toBeGreaterThanOrEqual(20);
    expect(sites.some((s) => s.file === 'scripts/workers/pipeline-orchestrator.mjs')).toBe(true);
  });

  it('every insert names submitted_by', () => {
    const missing = sites.filter((s) => !/\bsubmitted_by\s*:/.test(s.body)).map((s) => `${s.file}:${s.line}`);
    expect(missing).toEqual([]);
  });
});
