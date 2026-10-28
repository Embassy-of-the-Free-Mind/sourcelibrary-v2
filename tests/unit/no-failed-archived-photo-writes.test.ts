/**
 * #5448 — nothing writes a `failed:` string into `archived_photo`.
 *
 * Archivers select work by `archived_photo` being absent, so a `failed:` marker there hides the page from
 * every archiver for good: the write erases its own repair path (archive-fetch-failures.md). The rule was
 * written down and broken anyway — five scripts still wrote it, and on 2026-10-27 lane-gallica archived 0
 * pages for nine hours drawing 37 visible books whose every remaining page carried
 * `failed:source-not-found`, some of them serving 200 today. A failure belongs in
 * `archive_metadata.last_failure_*` (scripts/lib/archive-miss.mjs `missUpdate` for a URL that is gone).
 *
 * PRIOR ART: tests/unit/cursor-batchsize-guard.test.ts (same sweep-guard shape); archive-failure-class.test.ts
 * classifies EXISTING markers and is unaffected.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');

/**
 * `archived_photo:` followed by a literal or template starting `failed:` on one line, or a reason
 * variable that a nearby line built from `failed:`. The second form is how archive-gallica.mjs did it.
 */
const DIRECT = /archived_photo\s*:\s*[`'"]failed:/;
function offendingLines(src: string): number[] {
  const lines = src.split('\n');
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(l)) return; // a comment describing the marker is not a write
    if (DIRECT.test(l)) { out.push(i + 1); return; }
    const m = l.match(/archived_photo\s*:\s*([A-Za-z_$][\w$]*)\s*[,}]/);
    if (!m) return;
    const decl = new RegExp(`\\b${m[1]}\\s*=\\s*[\`'"]failed:`);
    if (lines.slice(Math.max(0, i - 15), i).some(p => decl.test(p))) out.push(i + 1);
  });
  return out;
}

function trackedSources(): string[] {
  return execFileSync('git', ['ls-files', '--', 'scripts', 'src'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(f => /\.(m?js|ts|tsx)$/.test(f) && !f.startsWith('scripts/_archived/'));
}

describe('no writer puts a failed: marker in archived_photo (#5448)', () => {
  it('scripts/ and src/ are clean', async () => {
    const fs = await import('fs');
    const offenders = trackedSources().flatMap(f =>
      offendingLines(fs.readFileSync(path.join(ROOT, f), 'utf8')).map(n => `${f}:${n}`));
    expect(offenders).toEqual([]);
  });
});

describe('scanner (planted regressions)', () => {
  it('flags a template literal', () => {
    expect(offendingLines("await pages.updateOne(q, { $set: { archived_photo: `failed:${msg}` } });")).toEqual([1]);
  });
  it('flags a reason variable built from failed:', () => {
    expect(offendingLines("const why = `failed:source-not-found`;\nawait x({ $set: { archived_photo: why, n: 1 } });")).toEqual([2]);
  });
  it('ignores comments that describe the marker', () => {
    expect(offendingLines(' * Clear page-level `archived_photo: "failed:…"` markers')).toEqual([]);
  });
  it('leaves the archive_metadata form and real URLs alone', () => {
    expect(offendingLines("{ $set: { 'archive_metadata.last_failure_reason': msg } }\n{ archived_photo: url }")).toEqual([]);
  });
});
