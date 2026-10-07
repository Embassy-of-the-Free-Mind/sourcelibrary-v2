import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Every orchestrator query that selects books by `pipeline_auto.status` must also carry
// NOT_HELD (scripts/lib/pipeline-hold.mjs). Selecting on status alone trusts every writer in
// the repo to respect the hold: archive-erara.mjs did not, wrote `archive_complete` over 329
// held e-rara books, and Phase 2 OCR'd 30 of them (#6122). With the marker in the filter, a
// clobbered book is frozen where it lands instead of re-entering a lane.
//
// Matched: a line with a `'pipeline_auto.status':` predicate that is not a `$set`, inside a
// `books` query (not books_warehouse, not a countDocuments/distinct read). NOT_HELD must sit on
// the same line or within the two lines above it (the same object literal, by this file's style).
//
// Negative control: removing `...NOT_HELD,` from any phase (e.g. Phase 2's preview pass) fails
// this test on that line.
const repoRoot = path.resolve(__dirname, '..', '..');
const src = readFileSync(path.join(repoRoot, 'scripts/workers/pipeline-orchestrator.mjs'), 'utf8');
const lines = src.split('\n');

// Reads that are not lane selection: the DB health probe, and log-only counts.
const EXEMPT = [
  /'pipeline_auto\.status': \{ \$exists: true \}/,
];

describe('pipeline-orchestrator: every status selection carries NOT_HELD (#6122)', () => {
  it('imports NOT_HELD from pipeline-hold', () => {
    expect(src).toMatch(/import \{[^}]*\bNOT_HELD\b[^}]*\} from '\.\.\/lib\/pipeline-hold\.mjs'/);
  });

  it('no books query selects on pipeline_auto.status without NOT_HELD', () => {
    const offenders: string[] = [];
    lines.forEach((line, i) => {
      if (!/'pipeline_auto\.status':/.test(line)) return;
      if (/\$set/.test(line) || /^\s*\/\//.test(line)) return;
      if (EXEMPT.some((re) => re.test(line))) return;
      // Which call does this predicate belong to? Walk back to the nearest collection call.
      let call = '';
      for (let j = i; j >= Math.max(0, i - 12); j--) {
        const m = lines[j].match(/collection\('(\w+)'\)(\s*\.\s*\w+)?/);
        if (m) { call = lines.slice(j, i + 1).join(' '); break; }
      }
      if (/books_warehouse/.test(call)) return;
      if (/\.(countDocuments|distinct)\(/.test(call)) return;
      // A write, not a predicate: the line sits directly under `$set: {` or `.updateOne(` / `.insertOne(`
      // on a document literal (`{ id, ... 'pipeline_auto.status': ... }` filters keep the check).
      if (/\$set: \{\s*$/.test(lines[i - 1] ?? '')) return;
      const window = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
      if (!/\.\.\.NOT_HELD/.test(window)) offenders.push(`line ${i + 1}: ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });
});
